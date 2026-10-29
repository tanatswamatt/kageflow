-- Kageflow 0024: hand a car over between Kageflow dealerships.
-- Dealer A invoices a car to a customer linked to dealer B (by B's dealer code). The car's details and photos go to B
-- as an incoming car; B accepts it into stock. What A paid, A's recon costs and A's customers never travel.

-- every dealership gets a short code to give to the dealers it buys from
alter table public.companies add column dealer_code text unique
  default ('KF-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)))
  check (dealer_code ~ '^KF-[0-9A-Z]{6}$');
update public.companies set dealer_code = 'KF-' || upper(substr(md5(id::text || clock_timestamp()::text), 1, 6)) where dealer_code is null;
alter table public.companies alter column dealer_code set not null;

-- a customer (or supplier) that is itself a dealership on Kageflow
alter table public.crm_accounts add column kageflow_company_id uuid references public.companies (id) on delete set null;

create table public.vehicle_transfers (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid not null references public.companies (id) on delete cascade,
  to_company_id uuid not null references public.companies (id) on delete cascade,
  from_unit_id uuid references public.inventory_units (id) on delete set null,
  invoice_id uuid references public.sales_docs (id) on delete set null,
  invoice_number text,
  from_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  details jsonb not null,
  photos jsonb not null default '[]'::jsonb,
  price_net numeric(18, 2),
  price_vat numeric(18, 2),
  currency char(3) not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  to_unit_id uuid references public.inventory_units (id) on delete set null,
  check (from_company_id <> to_company_id)
);
create unique index vehicle_transfers_once on public.vehicle_transfers (from_unit_id, to_company_id) where status in ('pending', 'accepted');
create index vehicle_transfers_to_idx on public.vehicle_transfers (to_company_id, status, created_at desc);
create index vehicle_transfers_from_idx on public.vehicle_transfers (from_company_id, created_at desc);

alter table public.vehicle_transfers enable row level security;
create policy vehicle_transfers_select on public.vehicle_transfers for select to authenticated using (
  private.has_role(from_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[])
  or private.has_role(to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
revoke all on public.vehicle_transfers from anon;
revoke insert, update, delete, truncate, trigger, references on public.vehicle_transfers from authenticated;
create trigger audit_vehicle_transfers after insert or update or delete on public.vehicle_transfers for each row execute function private.audit_row();

-- name of the dealership behind a code, so the seller can check it before linking
create function public.find_dealer(p_code text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', name, 'country', country) from public.companies
   where dealer_code = upper(trim(p_code)) and auth.uid() is not null;
$$;

-- link one of my customers to their Kageflow dealership
create function public.link_account_dealer(p_account uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.crm_accounts;
  c public.companies;
begin
  select * into a from public.crm_accounts where id = p_account;
  if a.id is null or not private.has_role(a.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Customer not found';
  end if;
  if nullif(trim(coalesce(p_code, '')), '') is null then
    update public.crm_accounts set kageflow_company_id = null where id = a.id;
    return null;
  end if;
  select * into c from public.companies where dealer_code = upper(trim(p_code));
  if c.id is null then raise exception 'No Kageflow dealership has the code %. Check it with them', upper(trim(p_code)); end if;
  if c.id = a.company_id then raise exception 'That''s your own dealer code'; end if;
  update public.crm_accounts set kageflow_company_id = c.id where id = a.id;
  return c.name;
end $$;

-- after an invoice is issued: send each car on it to the buyer's Kageflow. Returns how many were sent.
create function public.send_vehicle_transfers(p_invoice uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.sales_docs;
  a public.crm_accounts;
  co public.companies;
  l record;
  u public.inventory_units;
  n integer := 0;
begin
  select * into d from public.sales_docs where id = p_invoice;
  if d.id is null or not private.has_role(d.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Invoice not found';
  end if;
  if d.doc_type <> 'invoice' or d.status <> 'issued' or d.journal_id is null then raise exception 'Issue the invoice first'; end if;
  select * into a from public.crm_accounts where id = d.account_id;
  if a.kageflow_company_id is null then raise exception 'Link % to their Kageflow dealer code first', a.name; end if;
  select * into co from public.companies where id = d.company_id;

  for l in select * from public.sales_doc_lines where doc_id = d.id and unit_id is not null order by line_no loop
    select * into u from public.inventory_units where id = l.unit_id;
    continue when u.id is null;
    continue when exists (select 1 from public.vehicle_transfers where from_unit_id = u.id and to_company_id = a.kageflow_company_id and status in ('pending', 'accepted'));
    insert into public.vehicle_transfers (from_company_id, to_company_id, from_unit_id, invoice_id, invoice_number, from_name, details, photos, price_net, price_vat, currency)
    values (d.company_id, a.kageflow_company_id, u.id, d.id, d.number, co.name,
      jsonb_strip_nulls(jsonb_build_object(
        'vin', u.serial_no, 'vin_confirmed', u.vin_confirmed, 'make', u.make, 'model', u.model, 'variant', u.variant, 'year', u.year,
        'colour', u.colour, 'engine_no', u.engine_no, 'mileage_km', u.mileage_km, 'transmission', u.transmission, 'fuel_type', u.fuel_type,
        'body_type', u.body_type, 'features', to_jsonb(u.features), 'advert_title', u.advert_title,
        'advert_description', coalesce(u.advert_description, u.description), 'stock_no', u.stock_no)),
      coalesce((select jsonb_agg(p.url order by p.position) from public.vehicle_photos p where p.unit_id = u.id),
               case when u.image_url is not null then jsonb_build_array(u.image_url) else '[]'::jsonb end),
      l.line_subtotal, l.line_tax, d.currency);
    n := n + 1;
  end loop;
  return n;
end $$;

-- the buyer takes the car into stock. Returns the new car and what the seller charged, for posting the cost.
create function public.accept_vehicle_transfer(p_id uuid, p_location text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.vehicle_transfers;
  co public.companies;
  src public.companies;
  v_supplier uuid;
  v_product uuid;
  v_unit uuid;
  v_vin text;
begin
  select * into t from public.vehicle_transfers where id = p_id for update;
  if t.id is null or not private.has_role(t.to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Incoming car not found';
  end if;
  if t.status <> 'pending' then raise exception 'This car was already %', t.status; end if;
  select * into co from public.companies where id = t.to_company_id;
  select * into src from public.companies where id = t.from_company_id;
  v_vin := upper(coalesce(t.details ->> 'vin', ''));
  if exists (select 1 from public.inventory_units where company_id = co.id and upper(serial_no) = v_vin) then
    raise exception 'VIN % is already in your stock', v_vin;
  end if;

  -- the seller as a supplier in the buyer's books
  select id into v_supplier from public.crm_accounts where company_id = co.id and kageflow_company_id = src.id order by created_at limit 1;
  if v_supplier is null and nullif(trim(coalesce(src.vat_no, '')), '') is not null then
    select id into v_supplier from public.crm_accounts where company_id = co.id and vat_no = src.vat_no order by created_at limit 1;
  end if;
  if v_supplier is null then
    insert into public.crm_accounts (company_id, name, kind, vat_no, email, phone, billing_address, country, kageflow_company_id)
    values (co.id, src.name, 'supplier', src.vat_no, src.email, src.phone, src.address, src.country, src.id)
    returning id into v_supplier;
  else
    update public.crm_accounts set kageflow_company_id = coalesce(kageflow_company_id, src.id) where id = v_supplier;
  end if;

  select id into v_product from public.products where company_id = co.id and tracking = 'serial' order by (sku = 'VEHICLE') desc, created_at limit 1;
  insert into public.inventory_units (company_id, product_id, serial_no, vin_confirmed, make, model, variant, year, colour, engine_no, mileage_km,
    transmission, fuel_type, body_type, features, advert_title, advert_description, is_second_hand, status, location,
    supplier_account_id, acquired_on, list_currency, notes)
  values (co.id, v_product, v_vin, coalesce((t.details ->> 'vin_confirmed')::boolean, false), t.details ->> 'make', t.details ->> 'model',
    t.details ->> 'variant', (t.details ->> 'year')::int, t.details ->> 'colour', t.details ->> 'engine_no', (t.details ->> 'mileage_km')::int,
    t.details ->> 'transmission', t.details ->> 'fuel_type', t.details ->> 'body_type',
    case when jsonb_typeof(t.details -> 'features') = 'array' then array(select jsonb_array_elements_text(t.details -> 'features')) end,
    t.details ->> 'advert_title', t.details ->> 'advert_description', true, 'in_stock', nullif(trim(coalesce(p_location, '')), ''),
    v_supplier, current_date, co.base_currency,
    left('Bought from ' || src.name || coalesce(' on invoice ' || t.invoice_number, '') || ' through Kageflow', 2000))
  returning id into v_unit;

  update public.vehicle_transfers set status = 'accepted', decided_at = now(), decided_by = auth.uid(), to_unit_id = v_unit where id = t.id;
  return jsonb_build_object('unit_id', v_unit, 'supplier_id', v_supplier, 'photos', t.photos,
    'price_net', t.price_net, 'price_vat', t.price_vat, 'currency', t.currency, 'base_currency', co.base_currency, 'invoice_number', t.invoice_number);
end $$;

create function public.decline_vehicle_transfer(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.vehicle_transfers;
begin
  select * into t from public.vehicle_transfers where id = p_id for update;
  if t.id is null or not private.has_role(t.to_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Incoming car not found';
  end if;
  if t.status <> 'pending' then raise exception 'This car was already %', t.status; end if;
  update public.vehicle_transfers set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = t.id;
end $$;

create function public.cancel_vehicle_transfer(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.vehicle_transfers;
begin
  select * into t from public.vehicle_transfers where id = p_id for update;
  if t.id is null or not private.has_role(t.from_company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Sent car not found';
  end if;
  if t.status <> 'pending' then raise exception 'The buyer already %', t.status; end if;
  update public.vehicle_transfers set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = t.id;
end $$;

revoke all on function public.find_dealer(text), public.link_account_dealer(uuid, text), public.send_vehicle_transfers(uuid),
  public.accept_vehicle_transfer(uuid, text), public.decline_vehicle_transfer(uuid), public.cancel_vehicle_transfer(uuid) from public, anon;
grant execute on function public.find_dealer(text), public.link_account_dealer(uuid, text), public.send_vehicle_transfers(uuid),
  public.accept_vehicle_transfer(uuid, text), public.decline_vehicle_transfer(uuid), public.cancel_vehicle_transfer(uuid) to authenticated;

-- name of the Kageflow dealership one of my accounts is linked to (companies aren't readable across dealerships)
create function public.linked_dealer(p_account uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'code', c.dealer_code)
    from public.crm_accounts a join public.companies c on c.id = a.kageflow_company_id
   where a.id = p_account and private.is_member(a.company_id);
$$;
revoke all on function public.linked_dealer(uuid) from public, anon;
grant execute on function public.linked_dealer(uuid) to authenticated;
