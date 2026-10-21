-- Kageflow 0006: invoice details, tax rates, products, serial-tracked units (vehicles) and landed cost
-- Units are bought in pieces (purchase, transport, clearing, duty...). Every cost entry posts
-- Dr Inventory (+ Dr VAT input) / Cr where it was paid from, and the unit's landed cost is their sum.

-- ---------- invoice details on company and customer ----------
alter table public.companies
  add column address text,
  add column phone text,
  add column email text,
  add column bank_details text,
  add column invoice_footer text,
  add column default_payment_days int not null default 30 check (default_payment_days between 0 and 365);

alter table public.crm_accounts
  add column billing_address text,
  add column payment_days int check (payment_days between 0 and 365);

alter table public.crm_leads add column external_ref text;
create unique index crm_leads_external_ref_idx on public.crm_leads (company_id, external_ref) where external_ref is not null;

-- ---------- tax rates ----------
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  rate numeric(6, 4) not null check (rate >= 0 and rate < 1),
  is_zero_rated boolean not null default false,
  is_active boolean not null default true,
  unique (company_id, code),
  unique (company_id, id)
);

-- ---------- products ----------
create type public.product_tracking as enum ('serial', 'none');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  sku text not null,
  name text not null check (length(trim(name)) > 0),
  description text,
  tracking public.product_tracking not null default 'none',
  sale_price numeric(18, 2) check (sale_price >= 0),
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  tax_rate_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sku),
  unique (company_id, id),
  foreign key (company_id, tax_rate_id) references public.tax_rates (company_id, id)
);
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();

-- ---------- serial-tracked units ----------
create type public.unit_status as enum ('on_order', 'in_transit', 'in_stock', 'reserved', 'sold', 'written_off');

create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid,
  serial_no text not null check (length(trim(serial_no)) between 3 and 40),
  make text,
  model text,
  variant text,
  year int check (year between 1950 and 2100),
  colour text,
  engine_no text,
  mileage_km int check (mileage_km >= 0),
  is_second_hand boolean not null default true,
  location text,
  status public.unit_status not null default 'in_stock',
  list_price numeric(18, 2) check (list_price >= 0),
  list_currency char(3) not null default 'ZAR' check (list_currency ~ '^[A-Z]{3}$'),
  supplier_account_id uuid,
  acquired_on date,
  sold_doc_id uuid,
  sold_at timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, serial_no),
  unique (company_id, id),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, supplier_account_id) references public.crm_accounts (company_id, id) on delete set null (supplier_account_id)
);
create index inventory_units_status_idx on public.inventory_units (company_id, status);
create trigger inventory_units_touch before update on public.inventory_units for each row execute function private.touch_updated_at();

-- Sold is set only by issuing an invoice; a sold unit's identity is frozen
create function private.guard_unit()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('kageflow.system', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status = 'sold' and not v_system then
      raise exception 'Units become sold when an invoice is issued';
    end if;
    return new;
  end if;
  if not v_system then
    if new.status = 'sold' and old.status <> 'sold' then
      raise exception 'Units become sold when an invoice is issued';
    end if;
    if old.status = 'sold' and (new.status <> old.status or new.serial_no <> old.serial_no or new.sold_doc_id is distinct from old.sold_doc_id) then
      raise exception 'Unit % is sold; issue a credit note to return it to stock', old.serial_no;
    end if;
  end if;
  return new;
end $$;
create trigger inventory_units_guard before insert or update on public.inventory_units
  for each row execute function private.guard_unit();

-- ---------- landed cost entries ----------
create type public.unit_cost_kind as enum ('purchase', 'transport', 'clearing', 'duty', 'repairs', 'other');

create table public.unit_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid not null,
  kind public.unit_cost_kind not null,
  description text,
  cost_date date not null default current_date,
  amount numeric(18, 2) not null check (amount > 0),
  vat_amount numeric(18, 2) not null default 0 check (vat_amount >= 0),
  paid_from_account_id uuid not null,
  supplier_account_id uuid,
  reference text,
  journal_id uuid,
  reversal_journal_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id),
  foreign key (company_id, paid_from_account_id) references public.accounts (company_id, id),
  foreign key (company_id, supplier_account_id) references public.crm_accounts (company_id, id) on delete set null (supplier_account_id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index unit_costs_unit_idx on public.unit_costs (company_id, unit_id);

create view public.unit_values with (security_invoker = true) as
  select u.id as unit_id, u.company_id,
         coalesce(sum(c.amount) filter (where c.reversal_journal_id is null), 0)::numeric(18, 2) as landed_cost,
         count(c.id) filter (where c.reversal_journal_id is null) as cost_entries
    from public.inventory_units u
    left join public.unit_costs c on c.unit_id = u.id
   group by u.id, u.company_id;

create function private.system_account(p_company uuid, p_key text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.accounts where company_id = p_company and system_key = p_key;
$$;

create function public.add_unit_cost(
  p_unit uuid,
  p_kind public.unit_cost_kind,
  p_amount numeric,
  p_paid_from uuid,
  p_vat numeric default 0,
  p_date date default current_date,
  p_description text default null,
  p_supplier uuid default null,
  p_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u public.inventory_units;
  v_cost uuid;
  v_journal uuid;
  v_lines jsonb;
begin
  select * into u from public.inventory_units where id = p_unit;
  if u.id is null or not private.has_role(u.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Unit not found, or only owners, admins and accountants can add costs';
  end if;
  if u.status in ('sold', 'written_off') then
    raise exception 'Unit % is %; costs can no longer be added', u.serial_no, u.status;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cost amount must be more than zero';
  end if;
  if not exists (select 1 from public.accounts where id = p_paid_from and company_id = u.company_id and type in ('asset', 'liability')) then
    raise exception 'Pick the bank, payables or clearing account the cost was paid from';
  end if;

  insert into public.unit_costs (company_id, unit_id, kind, description, cost_date, amount, vat_amount, paid_from_account_id, supplier_account_id, reference)
  values (u.company_id, u.id, p_kind, p_description, p_date, round(p_amount, 2), round(coalesce(p_vat, 0), 2), p_paid_from, p_supplier, p_reference)
  returning id into v_cost;

  v_lines := jsonb_build_array(jsonb_build_object('account_id', private.system_account(u.company_id, 'inventory'), 'debit', round(p_amount, 2),
                                                  'description', initcap(p_kind::text) || ' ' || u.serial_no));
  if coalesce(p_vat, 0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(u.company_id, 'vat_input'), 'debit', round(p_vat, 2));
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', p_paid_from, 'credit', round(p_amount, 2) + round(coalesce(p_vat, 0), 2));

  v_journal := public.post_document(u.company_id, 'unit_cost', v_cost, p_date,
    coalesce(nullif(trim(p_description), ''), initcap(p_kind::text)) || ' - ' || u.serial_no, v_lines);
  update public.unit_costs set journal_id = v_journal where id = v_cost;
  return v_cost;
end $$;

create function public.reverse_unit_cost(p_cost uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.unit_costs;
  u public.inventory_units;
  v_rev uuid;
begin
  select * into c from public.unit_costs where id = p_cost for update;
  if c.id is null or not private.has_role(c.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Cost not found, or only owners, admins and accountants can reverse costs';
  end if;
  if c.reversal_journal_id is not null then
    raise exception 'This cost is already reversed';
  end if;
  select * into u from public.inventory_units where id = c.unit_id;
  if u.status in ('sold', 'written_off') then
    raise exception 'Unit % is %; its costs are final', u.serial_no, u.status;
  end if;
  v_rev := public.reverse_journal(c.journal_id, current_date, coalesce(p_reason, 'Cost reversed'));
  update public.unit_costs set reversal_journal_id = v_rev where id = c.id;
  return v_rev;
end $$;

revoke all on function public.add_unit_cost(uuid, public.unit_cost_kind, numeric, uuid, numeric, date, text, uuid, text) from public, anon;
revoke all on function public.reverse_unit_cost(uuid, text) from public, anon;
grant execute on function public.add_unit_cost(uuid, public.unit_cost_kind, numeric, uuid, numeric, date, text, uuid, text) to authenticated;
grant execute on function public.reverse_unit_cost(uuid, text) to authenticated;
revoke all on function private.system_account(uuid, text) from public;

-- ---------- RLS ----------
alter table public.tax_rates enable row level security;
alter table public.products enable row level security;
alter table public.inventory_units enable row level security;
alter table public.unit_costs enable row level security;

create policy tax_rates_select on public.tax_rates for select to authenticated using (private.is_member(company_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

create policy products_select on public.products for select to authenticated using (private.is_member(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy products_update on public.products for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy units_select on public.inventory_units for select to authenticated using (private.is_member(company_id));
create policy units_insert on public.inventory_units for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy units_update on public.inventory_units for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy unit_costs_select on public.unit_costs for select to authenticated using (private.is_member(company_id));
-- cost entries are written by add_unit_cost only

revoke all on public.tax_rates, public.products, public.inventory_units, public.unit_costs from anon;
revoke insert, update on public.unit_costs from authenticated;

create trigger audit_tax_rates after insert or update or delete on public.tax_rates for each row execute function private.audit_row();
create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_row();
create trigger audit_inventory_units after insert or update or delete on public.inventory_units for each row execute function private.audit_row();
create trigger audit_unit_costs after insert or update or delete on public.unit_costs for each row execute function private.audit_row();

-- ---------- seed ----------
create function private.seed_catalog(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_std uuid;
begin
  insert into public.tax_rates (company_id, code, name, rate, is_zero_rated) values
    (p_company, 'STD', 'Standard rate 15%', 0.15, false),
    (p_company, 'ZERO', 'Zero-rated (export)', 0, true),
    (p_company, 'EXEMPT', 'Exempt', 0, false),
    (p_company, 'NONE', 'No VAT (not a VAT vendor)', 0, false)
  on conflict (company_id, code) do nothing;
  select id into v_std from public.tax_rates where company_id = p_company and code = 'STD';
  insert into public.products (company_id, sku, name, tracking, tax_rate_id) values
    (p_company, 'VEHICLE', 'Motor vehicle', 'serial', v_std),
    (p_company, 'SERVICE', 'Service', 'none', v_std)
  on conflict (company_id, sku) do nothing;
end $$;

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
  perform private.seed_catalog(p_company);
end $$;

-- companies created before this migration
do $$
declare c record;
begin
  for c in select id from public.companies loop
    perform private.seed_catalog(c.id);
  end loop;
end $$;
