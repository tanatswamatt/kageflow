-- Kageflow 0009: stock-counted products, website stock sync, VIN confirmation
-- (0009a, applied separately because new enum values must be committed before use:
--   alter type public.product_tracking add value if not exists 'stock';
--   create type public.stock_move_kind as enum ('receipt', 'sale', 'return', 'adjustment');)

-- ---------- products counted in stock ----------
alter table public.products
  add column qty_on_hand numeric(18, 4) not null default 0,
  add column avg_cost numeric(18, 4) not null default 0 check (avg_cost >= 0),
  add column reorder_level numeric(18, 4),
  add column unit_label text,
  add column image_url text,
  add column external_source_id uuid,
  add column external_id text;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null,
  kind public.stock_move_kind not null,
  qty numeric(18, 4) not null check (qty <> 0),
  unit_cost numeric(18, 4) not null default 0,
  doc_id uuid,
  reference text,
  journal_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, doc_id) references public.sales_docs (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id)
);
create index stock_movements_product_idx on public.stock_movements (company_id, product_id, created_at desc);

create function private.guard_product()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_system() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.qty_on_hand <> 0 or new.avg_cost <> 0 then
      raise exception 'Add stock with Receive stock so it is costed and posted';
    end if;
    return new;
  end if;
  if new.qty_on_hand <> old.qty_on_hand or new.avg_cost <> old.avg_cost then
    raise exception 'Stock levels change through receipts, sales and stock counts';
  end if;
  if old.tracking = 'stock' and new.tracking <> 'stock' and old.qty_on_hand <> 0 then
    raise exception 'Count this product down to zero before it stops being stock-tracked';
  end if;
  return new;
end $$;
create trigger products_guard before insert or update on public.products
  for each row execute function private.guard_product();

create function public.receive_stock(
  p_product uuid, p_qty numeric, p_unit_cost numeric, p_paid_from uuid,
  p_vat numeric default 0, p_date date default current_date, p_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.products;
  v_total numeric;
  v_lines jsonb;
  v_journal uuid;
  v_move uuid;
begin
  select * into p from public.products where id = p_product for update;
  if p.id is null or not private.has_role(p.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Product not found, or only owners, admins and accountants can receive stock';
  end if;
  if p.tracking <> 'stock' then
    raise exception '% is not counted in stock. Change its tracking to Stock first', p.name;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Unit cost cannot be negative'; end if;
  if not exists (select 1 from public.accounts where id = p_paid_from and company_id = p.company_id and type in ('asset', 'liability')) then
    raise exception 'Pick the bank, payables or clearing account the stock was paid from';
  end if;

  v_total := round(p_qty * p_unit_cost, 2);
  insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, reference)
  values (p.company_id, p.id, 'receipt', p_qty, p_unit_cost, p_reference)
  returning id into v_move;

  if v_total + coalesce(p_vat, 0) > 0 then
    v_lines := '[]'::jsonb;
    if v_total > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p.company_id, 'inventory'), 'debit', v_total, 'description', p.name);
    end if;
    if coalesce(p_vat, 0) > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p.company_id, 'vat_input'), 'debit', round(p_vat, 2));
    end if;
    v_lines := v_lines || jsonb_build_object('account_id', p_paid_from, 'credit', v_total + round(coalesce(p_vat, 0), 2));
    if jsonb_array_length(v_lines) >= 2 then
      v_journal := public.post_document(p.company_id, 'stock_receipt', v_move, p_date,
        'Stock received: ' || trim(to_char(p_qty, 'FM999999990.####')) || ' x ' || p.name, v_lines);
    end if;
  end if;

  perform set_config('kageflow.system', 'on', true);
  update public.stock_movements set journal_id = v_journal where id = v_move;
  update public.products
     set avg_cost = case when qty_on_hand + p_qty > 0 then round((greatest(qty_on_hand, 0) * avg_cost + p_qty * p_unit_cost) / (greatest(qty_on_hand, 0) + p_qty), 4) else p_unit_cost end,
         qty_on_hand = qty_on_hand + p_qty
   where id = p.id;
  perform set_config('kageflow.system', 'off', true);
  return v_move;
end $$;

create function public.count_stock(p_product uuid, p_counted numeric, p_reason text default null, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.products;
  v_diff numeric;
  v_value numeric;
  v_move uuid;
  v_journal uuid;
begin
  select * into p from public.products where id = p_product for update;
  if p.id is null or not private.has_role(p.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Product not found, or only owners, admins and accountants can count stock';
  end if;
  if p.tracking <> 'stock' then raise exception '% is not counted in stock', p.name; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the quantity you counted'; end if;
  v_diff := p_counted - p.qty_on_hand;
  if v_diff = 0 then raise exception 'The count matches what Kageflow has; nothing to adjust'; end if;
  v_value := round(abs(v_diff) * p.avg_cost, 2);

  insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, reference)
  values (p.company_id, p.id, 'adjustment', v_diff, p.avg_cost, coalesce(p_reason, 'Stock count'))
  returning id into v_move;

  if v_value > 0 then
    v_journal := public.post_document(p.company_id, 'stock_adjustment', v_move, p_date,
      'Stock count: ' || p.name || coalesce(' (' || nullif(trim(p_reason), '') || ')', ''),
      case when v_diff < 0 then jsonb_build_array(
        jsonb_build_object('account_id', private.rule_account(p.company_id, 'sales_invoice', 'cogs'), 'debit', v_value, 'description', 'Stock shortfall'),
        jsonb_build_object('account_id', private.rule_account(p.company_id, 'sales_invoice', 'inventory'), 'credit', v_value))
      else jsonb_build_array(
        jsonb_build_object('account_id', private.rule_account(p.company_id, 'sales_invoice', 'inventory'), 'debit', v_value),
        jsonb_build_object('account_id', private.rule_account(p.company_id, 'sales_invoice', 'cogs'), 'credit', v_value, 'description', 'Stock surplus')) end);
  end if;

  perform set_config('kageflow.system', 'on', true);
  update public.stock_movements set journal_id = v_journal where id = v_move;
  update public.products set qty_on_hand = p_counted where id = p.id;
  perform set_config('kageflow.system', 'off', true);
  return v_move;
end $$;

-- ---------- units synced from a website ----------
alter table public.inventory_units
  add column vin_confirmed boolean not null default true,
  add column external_source_id uuid,
  add column external_id text,
  add column image_url text,
  add column site_status text,
  add column description text;
create unique index inventory_units_external_idx on public.inventory_units (company_id, external_source_id, external_id) where external_id is not null;

-- Website listings and stock follow the vehicle's status
create function private.unit_status_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.external_id is not null then
    perform private.emit_event(new.company_id, 'unit.updated', jsonb_build_object(
      'id', new.id, 'external_id', new.external_id, 'serial_no', case when new.vin_confirmed then new.serial_no end,
      'status', new.status, 'previous_status', old.status, 'sold_doc_id', new.sold_doc_id));
  end if;
  return null;
end $$;
create trigger inventory_units_status_event after update of status on public.inventory_units
  for each row execute function private.unit_status_event();

create table public.stock_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('supabase_vehicles', 'json_feed')),
  base_url text not null check (base_url ~ '^https://[^\s]+$'),
  api_key text,
  table_name text not null default 'vehicles' check (table_name ~ '^[a-z_][a-z0-9_]{0,62}$'),
  image_bucket text not null default 'vehicle-images' check (image_bucket ~ '^[a-z0-9_\-]{1,63}$'),
  include_images boolean not null default true,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_status text,
  last_counts jsonb,
  pending_request_id bigint,
  requested_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

alter table public.inventory_units
  add foreign key (company_id, external_source_id) references public.stock_sources (company_id, id) on delete set null (external_source_id);
alter table public.products
  add foreign key (company_id, external_source_id) references public.stock_sources (company_id, id) on delete set null (external_source_id);

-- One listing in the source's own shape -> Kageflow's shape
create function private.normalise_stock_item(s public.stock_sources, it jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_img text;
  v_path text;
begin
  if s.kind = 'supabase_vehicles' then
    if jsonb_typeof(it -> 'vehicle_images') = 'array' then
      select x ->> 'storage_path' into v_path
        from jsonb_array_elements(it -> 'vehicle_images') x
       order by coalesce((x ->> 'is_primary')::boolean, false) desc, coalesce((x ->> 'position')::int, 999)
       limit 1;
      if v_path is not null then
        v_img := s.base_url || '/storage/v1/object/public/' || s.image_bucket || '/' || v_path;
      end if;
    end if;
    return jsonb_build_object(
      'kind', 'vehicle',
      'external_id', it ->> 'id',
      'vin', nullif(trim(coalesce(it ->> 'vin', '')), ''),
      'make', it ->> 'make', 'model', it ->> 'model', 'variant', it ->> 'variant',
      'year', it ->> 'year', 'mileage_km', it ->> 'mileage_km',
      'price', it ->> 'price_zar', 'currency', 'ZAR',
      'status', it ->> 'status',
      'colour', coalesce(it ->> 'colour', it -> 'specs' ->> 'colour'),
      'description', it ->> 'description',
      'image_url', v_img);
  end if;
  return jsonb_build_object(
    'kind', coalesce(nullif(it ->> 'kind', ''), case when it ? 'sku' and not it ? 'vin' then 'product' else 'vehicle' end),
    'external_id', coalesce(it ->> 'external_id', it ->> 'id', it ->> 'sku', it ->> 'vin'),
    'vin', nullif(trim(coalesce(it ->> 'vin', '')), ''),
    'sku', it ->> 'sku', 'name', it ->> 'name',
    'make', it ->> 'make', 'model', it ->> 'model', 'variant', it ->> 'variant',
    'year', it ->> 'year', 'mileage_km', it ->> 'mileage_km',
    'price', it ->> 'price', 'currency', coalesce(nullif(it ->> 'currency', ''), 'ZAR'),
    'status', coalesce(it ->> 'status', 'in_stock'),
    'colour', it ->> 'colour', 'description', it ->> 'description', 'image_url', it ->> 'image_url');
end $$;

create function private.safe_numeric(p text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  return nullif(trim(p), '')::numeric;
exception when others then
  return null;
end $$;

-- Apply a whole feed. Kageflow owns a vehicle's status once it exists; the site's status is kept for display.
create function private.apply_stock_feed(p_source uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.stock_sources;
  it jsonb;
  n jsonb;
  v_product uuid;
  v_std uuid;
  v_unit public.inventory_units;
  v_created int := 0; v_updated int := 0; v_skipped int := 0; v_products int := 0;
  v_year int; v_km int; v_price numeric;
  v_site text;
  v_currency text;
begin
  select * into s from public.stock_sources where id = p_source;
  if s.id is null then raise exception 'Unknown stock source'; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'The website did not return a list of items';
  end if;
  select id into v_product from public.products where company_id = s.company_id and tracking = 'serial' and is_active order by created_at limit 1;
  select id into v_std from public.tax_rates where company_id = s.company_id and code = 'STD';

  perform set_config('kageflow.system', 'on', true);
  for it in select * from jsonb_array_elements(p_items) loop
   begin
    n := private.normalise_stock_item(s, it);
    if coalesce(n ->> 'external_id', '') = '' then v_skipped := v_skipped + 1; continue; end if;
    v_price := private.safe_numeric(n ->> 'price');
    v_currency := case when coalesce(n ->> 'currency', '') ~ '^[A-Z]{3}$' then n ->> 'currency' else 'ZAR' end;

    if n ->> 'kind' = 'product' then
      if coalesce(n ->> 'sku', '') = '' or coalesce(n ->> 'name', '') = '' then v_skipped := v_skipped + 1; continue; end if;
      insert into public.products (company_id, sku, name, description, tracking, sale_price, currency, tax_rate_id, image_url, external_source_id, external_id)
      values (s.company_id, upper(left(n ->> 'sku', 40)), left(n ->> 'name', 200), n ->> 'description', 'none', v_price, v_currency, v_std, n ->> 'image_url', s.id, n ->> 'external_id')
      on conflict (company_id, sku) do update
        set name = excluded.name, sale_price = excluded.sale_price, currency = excluded.currency,
            image_url = coalesce(excluded.image_url, public.products.image_url), description = coalesce(excluded.description, public.products.description),
            external_source_id = excluded.external_source_id, external_id = excluded.external_id;
      v_products := v_products + 1;
      continue;
    end if;

    v_year := private.safe_numeric(n ->> 'year')::int;
    if v_year is not null and (v_year < 1950 or v_year > 2100) then v_year := null; end if;
    v_km := case when private.safe_numeric(n ->> 'mileage_km') >= 0 then private.safe_numeric(n ->> 'mileage_km')::int end;
    v_site := lower(coalesce(n ->> 'status', ''));

    select * into v_unit from public.inventory_units
     where company_id = s.company_id and external_source_id = s.id and external_id = n ->> 'external_id';
    if v_unit.id is null and n ->> 'vin' is not null then
      select * into v_unit from public.inventory_units where company_id = s.company_id and serial_no = upper(n ->> 'vin');
    end if;

    if v_unit.id is null then
      -- listings already sold or withdrawn on the site are not imported as stock
      if v_site in ('sold', 'archived', 'withdrawn', 'removed') then v_skipped := v_skipped + 1; continue; end if;
      insert into public.inventory_units (company_id, product_id, serial_no, vin_confirmed, make, model, variant, year, colour, mileage_km,
                                          status, list_price, list_currency, external_source_id, external_id, image_url, site_status, description)
      values (s.company_id, v_product,
              coalesce(upper(n ->> 'vin'), 'TBC-' || upper(left(md5(s.id::text || (n ->> 'external_id')), 10))),
              n ->> 'vin' is not null,
              left(n ->> 'make', 60), left(n ->> 'model', 60), left(n ->> 'variant', 120), v_year, left(n ->> 'colour', 60), v_km,
              case when v_site in ('sourcing', 'on_order') then 'on_order' when v_site = 'in_transit' then 'in_transit' else 'in_stock' end::public.unit_status,
              case when v_price > 0 then v_price end, v_currency, s.id, n ->> 'external_id', n ->> 'image_url', v_site, left(n ->> 'description', 5000));
      v_created := v_created + 1;
    else
      update public.inventory_units
         set make = coalesce(left(n ->> 'make', 60), make),
             model = coalesce(left(n ->> 'model', 60), model),
             variant = coalesce(left(n ->> 'variant', 120), variant),
             year = coalesce(v_year, year),
             colour = coalesce(left(n ->> 'colour', 60), colour),
             mileage_km = coalesce(v_km, mileage_km),
             list_price = case when v_price > 0 and status not in ('sold') then v_price else list_price end,
             list_currency = case when v_price > 0 and status not in ('sold') then v_currency else list_currency end,
             image_url = coalesce(n ->> 'image_url', image_url),
             site_status = v_site,
             description = coalesce(left(n ->> 'description', 5000), description),
             external_source_id = s.id,
             external_id = n ->> 'external_id',
             serial_no = case when not vin_confirmed and n ->> 'vin' is not null then upper(n ->> 'vin') else serial_no end,
             vin_confirmed = vin_confirmed or n ->> 'vin' is not null
       where id = v_unit.id;
      v_updated := v_updated + 1;
    end if;
   exception when others then
    v_skipped := v_skipped + 1;
   end;
  end loop;
  perform set_config('kageflow.system', 'off', true);

  update public.stock_sources
     set last_synced_at = now(), last_status = 'ok',
         last_counts = jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'products', v_products, 'received', jsonb_array_length(p_items)),
         pending_request_id = null, requested_at = null
   where id = s.id;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'products', v_products);
end $$;

-- Called from the app's "Sync now" with the feed it fetched
create function public.apply_stock_sync(p_source uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.stock_sources where id = p_source;
  if v_company is null or not private.has_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Source not found, or only owners and admins can sync stock';
  end if;
  return private.apply_stock_feed(p_source, p_items);
end $$;

create function public.record_stock_sync_error(p_source uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.stock_sources where id = p_source;
  if v_company is null or not private.has_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Source not found';
  end if;
  update public.stock_sources set last_status = left(p_message, 300), last_synced_at = now() where id = p_source;
end $$;

-- Scheduled sync: every 5 minutes collect finished requests, and request sources not synced in 15 minutes
create function private.stock_source_url(s public.stock_sources)
returns text language sql immutable set search_path = '' as $$
  select case s.kind
    when 'supabase_vehicles' then s.base_url || '/rest/v1/' || s.table_name || '?select=' ||
      case when s.include_images then '*,vehicle_images(storage_path,is_primary,position)' else '*' end || '&limit=2000'
    else s.base_url end;
$$;

create function private.stock_sync_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.stock_sources;
  r record;
  v_req bigint;
  v_headers jsonb;
begin
  for s in select * from public.stock_sources where pending_request_id is not null loop
    select status_code, content, error_msg into r from net._http_response where id = s.pending_request_id;
    if found then
      if r.status_code between 200 and 299 then
        begin
          perform private.apply_stock_feed(s.id, r.content::jsonb);
        exception when others then
          update public.stock_sources set last_status = left('Could not read the feed: ' || sqlerrm, 300), last_synced_at = now(), pending_request_id = null where id = s.id;
        end;
      elsif r.status_code between 400 and 499 and s.kind = 'supabase_vehicles' and s.include_images then
        update public.stock_sources set include_images = false, pending_request_id = null, last_synced_at = null where id = s.id;
      else
        update public.stock_sources set last_status = left('Website answered ' || coalesce(r.status_code::text, r.error_msg, 'nothing'), 300), last_synced_at = now(), pending_request_id = null where id = s.id;
      end if;
    elsif s.requested_at < now() - interval '15 minutes' then
      update public.stock_sources set last_status = 'No answer from the website', last_synced_at = now(), pending_request_id = null where id = s.id;
    end if;
  end loop;

  for s in select * from public.stock_sources where is_active and pending_request_id is null and (last_synced_at is null or last_synced_at < now() - interval '14 minutes') loop
    v_headers := jsonb_build_object('Accept', 'application/json');
    if s.api_key is not null then
      v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || s.api_key);
      if s.kind = 'supabase_vehicles' then v_headers := v_headers || jsonb_build_object('apikey', s.api_key); end if;
    end if;
    begin
      v_req := net.http_get(url := private.stock_source_url(s), headers := v_headers, timeout_milliseconds := 20000);
      update public.stock_sources set pending_request_id = v_req, requested_at = now() where id = s.id;
    exception when others then
      update public.stock_sources set last_status = left('Could not reach the website: ' || sqlerrm, 300), last_synced_at = now() where id = s.id;
    end;
  end loop;
end $$;

revoke all on function public.receive_stock(uuid, numeric, numeric, uuid, numeric, date, text) from public, anon;
revoke all on function public.count_stock(uuid, numeric, text, date) from public, anon;
revoke all on function public.apply_stock_sync(uuid, jsonb) from public, anon;
revoke all on function public.record_stock_sync_error(uuid, text) from public, anon;
grant execute on function public.receive_stock(uuid, numeric, numeric, uuid, numeric, date, text) to authenticated;
grant execute on function public.count_stock(uuid, numeric, text, date) to authenticated;
grant execute on function public.apply_stock_sync(uuid, jsonb) to authenticated;
grant execute on function public.record_stock_sync_error(uuid, text) to authenticated;
revoke all on function private.apply_stock_feed(uuid, jsonb) from public;
revoke all on function private.stock_sync_tick() from public;

alter table public.stock_movements enable row level security;
alter table public.stock_sources enable row level security;
create policy stock_movements_select on public.stock_movements for select to authenticated using (private.is_member(company_id));
create policy stock_sources_select on public.stock_sources for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy stock_sources_insert on public.stock_sources for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy stock_sources_update on public.stock_sources for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy stock_sources_remove on public.stock_sources for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
revoke all on public.stock_movements, public.stock_sources from anon;
revoke insert, update on public.stock_movements from authenticated;

create trigger audit_stock_movements after insert or update or delete on public.stock_movements for each row execute function private.audit_row();
create trigger audit_stock_sources after insert or update or delete on public.stock_sources for each row execute function private.audit_row();

create extension if not exists pg_cron;
select cron.schedule('kageflow-stock-sync', '*/5 * * * *', 'select private.stock_sync_tick()');

-- Keep source keys out of the audit log too
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - 'secret' - 'key_hash' - 'share_token' - 'api_key'; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new) - 'secret' - 'key_hash' - 'share_token' - 'api_key'; end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  if tg_table_name = 'companies' then
    v_company := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_company := coalesce(v_new ->> 'company_id', v_old ->> 'company_id')::uuid;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id');
  insert into public.audit_log (company_id, table_name, record_id, action, actor, old_data, new_data)
  values (v_company, tg_table_name, v_id, tg_op, auth.uid(), v_old, v_new);
  return null;
end $$;
