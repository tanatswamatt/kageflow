-- Kageflow 0027: sell cars from suppliers' floor plans.
-- 1. A car can be LISTED: advertised from an approved supplier's floor, not owned, no cost in the books, VIN to follow.
-- 2. Inspect it (confirm the VIN), then BUY it: it becomes owned stock and the supplier is owed through a bill.
-- 3. Only approved suppliers' cars can be listed.
-- 4. A supplier on Kageflow can share chosen cars with a dealer; the dealer lists them and they stay in sync.

-- ---------- 1-3: listed cars ----------
alter table public.crm_accounts add column approved_supplier boolean not null default false;

alter table public.inventory_units
  add column supplier_price numeric(18, 2) check (supplier_price is null or supplier_price >= 0),
  add column supplier_currency char(3) check (supplier_currency is null or supplier_currency ~ '^[A-Z]{3}$'),
  add column registration_no text check (registration_no is null or length(registration_no) <= 20),
  add column reg_doc_path text,
  add column inspected_at timestamptz,
  add column inspected_by uuid references auth.users (id) on delete set null,
  add column source_share_id uuid;

-- only approved suppliers' cars may be listed
create function private.check_listing() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'listed' and (tg_op = 'INSERT' or old.status is distinct from 'listed' or old.supplier_account_id is distinct from new.supplier_account_id) then
    if new.supplier_account_id is null then
      raise exception 'Choose the supplier whose floor the car is on';
    end if;
    if not exists (select 1 from public.crm_accounts where id = new.supplier_account_id and company_id = new.company_id and approved_supplier) then
      raise exception 'Only approved suppliers'' cars can be listed. Tick Approved supplier on % first',
        (select name from public.crm_accounts where id = new.supplier_account_id);
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.unit_costs where unit_id = new.id and reversal_journal_id is null) then
      raise exception 'This car has costs in your books, so it is yours, not a supplier listing';
    end if;
  end if;
  return new;
end $$;
create trigger inventory_units_check_listing before insert or update on public.inventory_units
  for each row execute function private.check_listing();

-- registration documents hold the owner's personal details: a private bucket, readable by the dealership only
insert into storage.buckets (id, name, public) values ('vehicle-documents', 'vehicle-documents', false) on conflict (id) do nothing;
create policy vehicle_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-documents' and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-documents' and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_documents_replace on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-documents' and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_documents_drop on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-documents' and private.has_role(private.storage_company(name), array['owner', 'admin']::public.member_role[]));

-- confirm the VIN on the car itself
create function public.inspect_vehicle(p_unit uuid, p_vin text, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.inventory_units;
  v_vin text := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_listed text;
begin
  select * into u from public.inventory_units where id = p_unit for update;
  if u.id is null or not private.has_role(u.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Car not found';
  end if;
  if length(v_vin) <> 17 or v_vin ~ '[IOQ]' then raise exception 'A VIN has 17 letters and numbers, without I, O or Q'; end if;
  v_listed := case when u.serial_no ~ '^TBC-' then null else upper(u.serial_no) end;
  if v_listed is not null and v_listed <> v_vin and not coalesce(p_override, false) then
    raise exception 'The VIN on the car (%) is not the one on record (%). Check the registration document before you buy', v_vin, v_listed;
  end if;
  if exists (select 1 from public.inventory_units where company_id = u.company_id and upper(serial_no) = v_vin and id <> u.id) then
    raise exception 'VIN % is already on another car in your stock', v_vin;
  end if;
  update public.inventory_units set serial_no = v_vin, vin_confirmed = true, inspected_at = now(), inspected_by = auth.uid() where id = u.id;
  return jsonb_build_object('vin', v_vin, 'changed', v_listed is not null and v_listed <> v_vin);
end $$;

-- buy a listed car: it becomes owned stock and the cost is posted (owed to the supplier by default, through a bill)
create function public.buy_listed_vehicle(p_unit uuid, p_amount numeric, p_vat numeric default 0, p_paid_from uuid default null,
  p_date date default current_date, p_reference text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u public.inventory_units;
  v_cost uuid;
  s record;
begin
  select * into u from public.inventory_units where id = p_unit for update;
  if u.id is null or not private.has_role(u.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Car not found, or only owners, admins and accountants can buy stock';
  end if;
  if u.status <> 'listed' then raise exception 'This car is not a supplier listing'; end if;
  if not u.vin_confirmed or u.serial_no ~ '^TBC-' then raise exception 'Inspect the car and confirm its VIN before you buy it'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter what you are paying, excluding VAT'; end if;

  perform set_config('kageflow.system', 'on', true);
  update public.inventory_units set status = 'in_stock', acquired_on = coalesce(p_date, current_date) where id = u.id;
  perform set_config('kageflow.system', 'off', true);
  v_cost := public.add_unit_cost(u.id, 'purchase', p_amount, coalesce(p_paid_from, private.system_account(u.company_id, 'payables')),
    coalesce(p_vat, 0), coalesce(p_date, current_date), 'Bought from the supplier''s floor', u.supplier_account_id, p_reference);

  -- a car shared by a supplier on Kageflow: hold it for us on their side
  if u.source_share_id is not null then
    select * into s from public.stock_shares where id = u.source_share_id for update;
    if s.id is not null and s.status = 'listed' then
      update public.stock_shares set status = 'bought', decided_at = now() where id = s.id;
      perform set_config('kageflow.system', 'on', true);
      update public.inventory_units
         set status = case when status in ('in_stock', 'in_transit', 'on_order') then 'reserved' else status end,
             notes = left(concat_ws(E'\n', notes, 'Bought by ' || (select name from public.companies where id = u.company_id) || ' through Kageflow on ' || to_char(current_date, 'DD Mon YYYY') || '. Invoice them for it.'), 4000)
       where id = s.unit_id;
      perform set_config('kageflow.system', 'off', true);
    end if;
  end if;
  return v_cost;
end $$;

-- take a listing down (the supplier sold it elsewhere, or we no longer want it)
create function public.remove_listing(p_unit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.inventory_units;
begin
  select * into u from public.inventory_units where id = p_unit for update;
  if u.id is null or not private.has_role(u.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Car not found';
  end if;
  if u.status <> 'listed' then raise exception 'Only supplier listings can be removed this way'; end if;
  if exists (select 1 from public.sales_doc_lines l join public.sales_docs d on d.id = l.doc_id where l.unit_id = u.id and d.status not in ('draft', 'cancelled', 'declined')) then
    raise exception 'This car is on a quote or order. Cancel those first';
  end if;
  update public.stock_shares set status = 'declined', decided_at = now() where id = u.source_share_id and status = 'listed';
  perform set_config('kageflow.system', 'on', true);
  update public.inventory_units set status = 'written_off', is_published = false,
    notes = left(concat_ws(E'\n', notes, 'Listing removed ' || to_char(current_date, 'DD Mon YYYY')), 4000) where id = u.id;
  perform set_config('kageflow.system', 'off', true);
end $$;

-- ---------- 4: suppliers share cars with a dealer ----------
create table public.stock_shares (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid not null references public.companies (id) on delete cascade,
  to_company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid not null references public.inventory_units (id) on delete cascade,
  price numeric(18, 2) not null check (price > 0),
  currency char(3) not null,
  status text not null default 'offered' check (status in ('offered', 'listed', 'declined', 'withdrawn', 'sold', 'bought')),
  broker_unit_id uuid references public.inventory_units (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_company_id <> to_company_id)
);
create unique index stock_shares_once on public.stock_shares (unit_id, to_company_id) where status in ('offered', 'listed', 'bought');
create index stock_shares_to_idx on public.stock_shares (to_company_id, status, created_at desc);
create index stock_shares_unit_idx on public.stock_shares (unit_id);
alter table public.inventory_units add constraint inventory_units_source_share_fk foreign key (source_share_id) references public.stock_shares (id) on delete set null;

alter table public.stock_shares enable row level security;
create policy stock_shares_select on public.stock_shares for select to authenticated using (
  private.has_role(from_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[])
  or private.has_role(to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
revoke all on public.stock_shares from anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_shares from authenticated;
create trigger audit_stock_shares after insert or update or delete on public.stock_shares for each row execute function private.audit_row();

-- the supplier offers one of its cars to a dealer (by dealer code) at a trade price; offering again changes the price
create function public.share_vehicle(p_unit uuid, p_code text, p_price numeric, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  u public.inventory_units;
  c public.companies;
  co public.companies;
  s public.stock_shares;
begin
  select * into u from public.inventory_units where id = p_unit;
  if u.id is null or not private.has_role(u.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Car not found';
  end if;
  if u.status not in ('in_stock', 'in_transit', 'on_order') then raise exception 'Only cars you have available can be shared'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Enter the price the dealer would pay you'; end if;
  select * into c from public.companies where dealer_code = upper(trim(coalesce(p_code, '')));
  if c.id is null then raise exception 'No Kageflow dealership has the code %', upper(trim(coalesce(p_code, ''))); end if;
  if c.id = u.company_id then raise exception 'That''s your own dealer code'; end if;
  select * into co from public.companies where id = u.company_id;
  select * into s from public.stock_shares where unit_id = u.id and to_company_id = c.id and status in ('offered', 'listed', 'bought') for update;
  if s.status = 'bought' then raise exception '% already bought this car', c.name; end if;
  if s.id is not null then
    update public.stock_shares set price = round(p_price, 2), note = nullif(trim(p_note), '') where id = s.id;
    if s.broker_unit_id is not null then
      update public.inventory_units set supplier_price = round(p_price, 2) where id = s.broker_unit_id;
    end if;
  else
    insert into public.stock_shares (from_company_id, to_company_id, unit_id, price, currency, note)
    values (u.company_id, c.id, u.id, round(p_price, 2), co.base_currency, nullif(trim(p_note), ''));
  end if;
  return c.name;
end $$;

-- stop a listing on the dealer's side (shared car withdrawn or sold by the supplier)
create function private.end_broker_listing(p_share uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.stock_shares;
begin
  select * into s from public.stock_shares where id = p_share for update;
  if s.id is null or s.status not in ('offered', 'listed') then return; end if;
  update public.stock_shares set status = p_status, decided_at = now() where id = s.id;
  if s.broker_unit_id is not null then
    perform set_config('kageflow.system', 'on', true);
    update public.inventory_units set is_published = false,
      notes = left(concat_ws(E'\n', notes, p_reason || ' ' || to_char(current_date, 'DD Mon YYYY')), 4000)
     where id = s.broker_unit_id and status = 'listed';
    perform set_config('kageflow.system', 'off', true);
  end if;
end $$;

create function public.withdraw_share(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.stock_shares;
begin
  select * into s from public.stock_shares where id = p_id;
  if s.id is null or not private.has_role(s.from_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Shared car not found';
  end if;
  if s.status = 'bought' then raise exception 'They already bought it'; end if;
  perform private.end_broker_listing(s.id, 'withdrawn', 'The supplier withdrew this car.');
end $$;

-- the dealer takes a shared car into its listings
create function public.accept_share(p_id uuid, p_price numeric default null, p_publish boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.stock_shares;
  u public.inventory_units;
  co public.companies;
  src public.companies;
  v_supplier uuid;
  v_product uuid;
  v_unit uuid;
  v_serial text;
begin
  select * into s from public.stock_shares where id = p_id for update;
  if s.id is null or not private.has_role(s.to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Shared car not found';
  end if;
  if s.status <> 'offered' then raise exception 'This car was already %', s.status; end if;
  select * into u from public.inventory_units where id = s.unit_id;
  if u.status not in ('in_stock', 'in_transit', 'on_order') then
    update public.stock_shares set status = 'sold', decided_at = now() where id = s.id;
    raise exception 'The supplier no longer has this car';
  end if;
  select * into co from public.companies where id = s.to_company_id;
  select * into src from public.companies where id = s.from_company_id;

  -- the supplier, approved by accepting
  select id into v_supplier from public.crm_accounts where company_id = co.id and kageflow_company_id = src.id order by created_at limit 1;
  if v_supplier is null and nullif(trim(coalesce(src.vat_no, '')), '') is not null then
    select id into v_supplier from public.crm_accounts where company_id = co.id and vat_no = src.vat_no order by created_at limit 1;
  end if;
  if v_supplier is null then
    insert into public.crm_accounts (company_id, name, kind, vat_no, email, phone, billing_address, country, kageflow_company_id, approved_supplier)
    values (co.id, src.name, 'supplier', src.vat_no, src.email, src.phone, src.address, src.country, src.id, true)
    returning id into v_supplier;
  else
    update public.crm_accounts set kageflow_company_id = coalesce(kageflow_company_id, src.id), approved_supplier = true where id = v_supplier;
  end if;

  v_serial := case when exists (select 1 from public.inventory_units where company_id = co.id and upper(serial_no) = upper(u.serial_no))
                   then 'TBC-' || upper(substr(md5(s.id::text), 1, 10)) else u.serial_no end;
  select id into v_product from public.products where company_id = co.id and tracking = 'serial' order by (sku = 'VEHICLE') desc, created_at limit 1;
  insert into public.inventory_units (company_id, product_id, serial_no, vin_confirmed, make, model, variant, year, colour, engine_no, mileage_km,
    transmission, fuel_type, body_type, features, advert_title, advert_description, image_url, is_second_hand, status, location,
    supplier_account_id, supplier_price, supplier_currency, registration_no, list_price, list_currency, advert_price, is_published, acquired_on, source_share_id, notes)
  values (co.id, v_product, v_serial, u.vin_confirmed and v_serial = u.serial_no, u.make, u.model, u.variant, u.year, u.colour, u.engine_no, u.mileage_km,
    u.transmission, u.fuel_type, u.body_type, u.features, u.advert_title, u.advert_description, u.image_url, u.is_second_hand, 'listed',
    'At ' || src.name, v_supplier, s.price, s.currency, u.registration_no,
    case when p_price > 0 then round(p_price, 2) end, co.base_currency, case when p_price > 0 then round(p_price, 2) end,
    coalesce(p_publish, false) and coalesce(p_price, 0) > 0, current_date, s.id,
    'Shared by ' || src.name || ' through Kageflow at ' || s.currency || ' ' || to_char(s.price, 'FM999G999G990D00'))
  returning id into v_unit;

  -- photos stay the supplier's files, shown on our listing
  insert into public.vehicle_photos (company_id, unit_id, url, storage_path, position)
  select co.id, v_unit, p.url, null, p.position from public.vehicle_photos p where p.unit_id = u.id;

  update public.stock_shares set status = 'listed', broker_unit_id = v_unit, decided_at = now() where id = s.id;
  return v_unit;
end $$;

create function public.decline_share(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.stock_shares;
begin
  select * into s from public.stock_shares where id = p_id for update;
  if s.id is null or not private.has_role(s.to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Shared car not found';
  end if;
  if s.status <> 'offered' then raise exception 'This car was already %', s.status; end if;
  update public.stock_shares set status = 'declined', decided_at = now() where id = s.id;
end $$;

-- keep shared listings in step with the supplier's car
create function private.sync_shared_unit() returns trigger language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  for s in select * from public.stock_shares where unit_id = new.id and status in ('offered', 'listed') loop
    if new.status in ('sold', 'written_off', 'reserved') then
      perform private.end_broker_listing(s.id, 'sold', 'The supplier sold or reserved this car.');
    elsif s.broker_unit_id is not null then
      perform set_config('kageflow.system', 'on', true);
      update public.inventory_units b
         set make = new.make, model = new.model, variant = new.variant, year = new.year, colour = new.colour, mileage_km = new.mileage_km,
             transmission = new.transmission, fuel_type = new.fuel_type, body_type = new.body_type, features = new.features,
             advert_description = coalesce(new.advert_description, b.advert_description), image_url = new.image_url,
             registration_no = coalesce(new.registration_no, b.registration_no),
             serial_no = case when b.serial_no ~ '^TBC-' and new.vin_confirmed
                               and not exists (select 1 from public.inventory_units x where x.company_id = b.company_id and upper(x.serial_no) = upper(new.serial_no))
                              then new.serial_no else b.serial_no end
       where b.id = s.broker_unit_id and b.status = 'listed';
      perform set_config('kageflow.system', 'off', true);
    end if;
  end loop;
  return new;
end $$;
create trigger inventory_units_sync_shares after update on public.inventory_units
  for each row when (pg_trigger_depth() < 2) execute function private.sync_shared_unit();

create function private.sync_shared_photos() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_photos (company_id, unit_id, url, storage_path, position)
    select b.company_id, b.id, new.url, null, new.position
      from public.stock_shares s join public.inventory_units b on b.id = s.broker_unit_id
     where s.unit_id = new.unit_id and s.status = 'listed' and b.status = 'listed';
    return new;
  else
    delete from public.vehicle_photos p using public.stock_shares s
     where s.unit_id = old.unit_id and s.status = 'listed' and p.unit_id = s.broker_unit_id and p.url = old.url and p.storage_path is null;
    return old;
  end if;
end $$;
create trigger vehicle_photos_sync_shares after insert or delete on public.vehicle_photos
  for each row when (pg_trigger_depth() < 2) execute function private.sync_shared_photos();

revoke all on function private.check_listing(), private.end_broker_listing(uuid, text, text), private.sync_shared_unit(), private.sync_shared_photos()
  from public, anon, authenticated;
revoke all on function public.inspect_vehicle(uuid, text, boolean), public.buy_listed_vehicle(uuid, numeric, numeric, uuid, date, text),
  public.remove_listing(uuid), public.share_vehicle(uuid, text, numeric, text), public.withdraw_share(uuid),
  public.accept_share(uuid, numeric, boolean), public.decline_share(uuid) from public, anon;
grant execute on function public.inspect_vehicle(uuid, text, boolean), public.buy_listed_vehicle(uuid, numeric, numeric, uuid, date, text),
  public.remove_listing(uuid), public.share_vehicle(uuid, text, numeric, text), public.withdraw_share(uuid),
  public.accept_share(uuid, numeric, boolean), public.decline_share(uuid) to authenticated;

-- ---------- existing functions that must know about listed cars ----------
do $patch$
declare r record; v_def text;
begin
  for r in select * from (values
    -- no costs on a car we don't own yet
    ('public.add_unit_cost(uuid,unit_cost_kind,numeric,uuid,numeric,date,text,uuid,text)',
     $a$  if u.status in ('sold', 'written_off') then
    raise exception 'Unit % is %; costs can no longer be added', u.serial_no, u.status;
  end if;$a$,
     $b$  if u.status in ('sold', 'written_off') then
    raise exception 'Unit % is %; costs can no longer be added', u.serial_no, u.status;
  end if;
  if u.status = 'listed' then
    raise exception 'This car is still on the supplier''s floor. Buy it first, or put the cost on an expense account';
  end if;$b$),
    -- no invoice for a car we haven't bought
    ('public.issue_sales_doc(uuid)',
     $a$        if l.unit_status in ('sold', 'written_off') then
          raise exception 'Unit % is already %', l.serial_no, l.unit_status;
        end if;$a$,
     $b$        if l.unit_status in ('sold', 'written_off') then
          raise exception 'Unit % is already %', l.serial_no, l.unit_status;
        end if;
        if l.unit_status = 'listed' then
          raise exception 'Buy % from the supplier before you invoice it (Buy from supplier on the car''s page)', l.serial_no;
        end if;$b$),
    -- a listed car only becomes stock by buying it
    ('private.guard_unit()',
     $a$  if not v_system then
    if new.status = 'sold' and old.status <> 'sold' then$a$,
     $b$  if not v_system then
    if old.status = 'listed' and new.status <> 'listed' then
      raise exception 'A listed car becomes your stock when you buy it (Buy from supplier on its page), or use Remove listing';
    end if;
    if new.status = 'sold' and old.status <> 'sold' then$b$),
    -- listed cars are advertised like stock
    ('public.stock_feed(text)', $a$(u.status = 'in_stock' or$a$, $b$(u.status in ('in_stock', 'listed') or$b$),
    -- a car bought through a share is not sent back as an incoming car when the supplier invoices it
    ('public.send_vehicle_transfers(uuid)',
     $a$    continue when exists (select 1 from public.vehicle_transfers where from_unit_id = u.id and to_company_id = a.kageflow_company_id and status in ('pending', 'accepted'));$a$,
     $b$    continue when exists (select 1 from public.vehicle_transfers where from_unit_id = u.id and to_company_id = a.kageflow_company_id and status in ('pending', 'accepted'));
    continue when exists (select 1 from public.stock_shares where unit_id = u.id and to_company_id = a.kageflow_company_id and status = 'bought');$b$)
  ) as x (fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old_text in v_def) = 0 then raise exception 'Patch for % did not find: %', r.fn, left(r.old_text, 80); end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $patch$;

-- both sides see each other's dealership name (companies aren't readable across dealerships)
alter table public.stock_shares add column from_name text, add column to_name text;
do $p$
declare v_def text := pg_get_functiondef('public.share_vehicle(uuid,text,numeric,text)'::regprocedure);
  v_old text := $a$    insert into public.stock_shares (from_company_id, to_company_id, unit_id, price, currency, note)
    values (u.company_id, c.id, u.id, round(p_price, 2), co.base_currency, nullif(trim(p_note), ''));$a$;
  v_new text := $b$    insert into public.stock_shares (from_company_id, to_company_id, unit_id, price, currency, note, from_name, to_name)
    values (u.company_id, c.id, u.id, round(p_price, 2), co.base_currency, nullif(trim(p_note), ''), co.name, c.name);$b$;
begin
  if position(v_old in v_def) = 0 then raise exception 'share_vehicle patch target missing'; end if;
  execute replace(v_def, v_old, v_new);
end $p$;

-- what a dealer sees of a car offered to it, before listing it (never the supplier's costs, customers or notes)
create function public.shared_cars(p_ids uuid[])
returns table (share_id uuid, make text, model text, variant text, year int, mileage_km int, colour text, image_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, u.make, u.model, u.variant, u.year, u.mileage_km, u.colour,
         coalesce((select p.url from public.vehicle_photos p where p.unit_id = u.id order by p.position limit 1), u.image_url)
    from public.stock_shares s join public.inventory_units u on u.id = s.unit_id
   where s.id = any (p_ids) and s.status = 'offered'
     and private.has_role(s.to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]);
$$;
revoke all on function public.shared_cars(uuid[]) from public, anon;
grant execute on function public.shared_cars(uuid[]) to authenticated;
