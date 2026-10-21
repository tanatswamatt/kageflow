-- Kageflow 0011: supplier bills, paid-now expenses and supplier payments
-- * A bill line is one of: an account (expense or asset), a counted stock product, or a cost on a vehicle (VIN)
-- * Posting a bill: Dr expense/asset/inventory, Dr VAT input, Cr Accounts payable (or the bank, for a paid-now expense)
-- * Companies without a VAT number cannot claim input VAT: the VAT is added to the cost instead
-- * Supplier payments settle bills in full or part; FX differences on foreign bills post to FX gain/loss
-- * All writes go through the functions below; tables are read-only to the app

create type public.bill_status as enum ('draft', 'posted', 'void');

alter table public.accounts add column is_capital boolean not null default false;
update public.accounts set is_capital = true where code in ('1500', '1600') and system_key is null;

create table public.purchase_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  supplier_id uuid not null,
  supplier_ref text,
  bill_date date not null default current_date,
  due_date date,
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  status public.bill_status not null default 'draft',
  paid_from_account_id uuid,
  subtotal numeric(18, 2) not null default 0,
  vat_total numeric(18, 2) not null default 0,
  total numeric(18, 2) not null default 0,
  amount_paid numeric(18, 2) not null default 0,
  amount_due numeric(18, 2) generated always as (case when status = 'posted' then total - amount_paid else 0 end) stored,
  notes text,
  draft_lines jsonb not null default '[]'::jsonb,
  journal_id uuid,
  void_journal_id uuid,
  void_reason text,
  posted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid >= 0 and amount_paid <= total),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, supplier_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, paid_from_account_id) references public.accounts (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, void_journal_id) references public.journals (company_id, id)
);
create index purchase_bills_company_idx on public.purchase_bills (company_id, bill_date desc);
create index purchase_bills_supplier_idx on public.purchase_bills (company_id, supplier_id);
create unique index purchase_bills_supplier_ref_idx on public.purchase_bills (company_id, supplier_id, lower(supplier_ref))
  where supplier_ref is not null and status <> 'void';
create trigger purchase_bills_touch before update on public.purchase_bills for each row execute function private.touch_updated_at();

create table public.purchase_bill_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bill_id uuid not null,
  line_no int not null,
  kind text not null check (kind in ('account', 'stock', 'vehicle')),
  account_id uuid,
  product_id uuid,
  unit_id uuid,
  cost_kind public.unit_cost_kind,
  description text not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price >= 0),
  tax_rate_id uuid,
  line_subtotal numeric(18, 2) not null,
  line_tax numeric(18, 2) not null default 0,
  line_total numeric(18, 2) not null,
  base_amount numeric(18, 2) not null,
  base_tax numeric(18, 2) not null default 0,
  unique (bill_id, line_no),
  foreign key (company_id, bill_id) references public.purchase_bills (company_id, id),
  foreign key (company_id, account_id) references public.accounts (company_id, id),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id),
  foreign key (company_id, tax_rate_id) references public.tax_rates (company_id, id)
);
create index purchase_bill_lines_bill_idx on public.purchase_bill_lines (bill_id);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  supplier_id uuid not null,
  payment_date date not null default current_date,
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount numeric(18, 2) not null check (amount > 0),
  bank_charges numeric(18, 2) not null default 0 check (bank_charges >= 0),
  bank_account_id uuid not null,
  reference text,
  journal_id uuid,
  reversal_journal_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, supplier_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, bank_account_id) references public.accounts (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index supplier_payments_company_idx on public.supplier_payments (company_id, payment_date desc);

create table public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payment_id uuid not null,
  bill_id uuid not null,
  amount numeric(18, 2) not null check (amount > 0),
  fx_difference numeric(18, 2) not null default 0,
  foreign key (company_id, payment_id) references public.supplier_payments (company_id, id),
  foreign key (company_id, bill_id) references public.purchase_bills (company_id, id)
);
create index supplier_payment_allocations_bill_idx on public.supplier_payment_allocations (company_id, bill_id);
create index supplier_payment_allocations_payment_idx on public.supplier_payment_allocations (company_id, payment_id);

-- vehicle costs and stock receipts that came from a bill
alter table public.unit_costs add column bill_id uuid;
alter table public.unit_costs add foreign key (company_id, bill_id) references public.purchase_bills (company_id, id);
alter table public.stock_movements add column bill_id uuid;
alter table public.stock_movements add foreign key (company_id, bill_id) references public.purchase_bills (company_id, id);

-- ---------- helpers ----------
-- Works out one draft line: {kind, account_id|product_id|unit_id, cost_kind, description, quantity, unit_price, tax_rate_id, vat?}
create function private.bill_line_values(p_company uuid, l jsonb, out v_sub numeric, out v_tax numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rate numeric := 0;
begin
  v_sub := round(coalesce(private.safe_numeric(l ->> 'quantity'), 0) * coalesce(private.safe_numeric(l ->> 'unit_price'), 0), 2);
  if nullif(l ->> 'tax_rate_id', '') is not null then
    select rate into v_rate from public.tax_rates where id = (l ->> 'tax_rate_id')::uuid and company_id = p_company;
  end if;
  if nullif(l ->> 'vat', '') is not null then
    v_tax := round(private.safe_numeric(l ->> 'vat'), 2);
  else
    v_tax := round(v_sub * coalesce(v_rate, 0), 2);
  end if;
  v_tax := coalesce(v_tax, 0);
end $$;

-- ---------- save a draft (create or update) ----------
create function public.save_bill(
  p_id uuid,
  p_company uuid,
  p_supplier uuid,
  p_supplier_ref text,
  p_bill_date date,
  p_due_date date,
  p_currency char(3),
  p_fx_rate numeric,
  p_paid_from uuid,
  p_notes text,
  p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.purchase_bills;
  co public.companies;
  v_sub numeric := 0; v_tax numeric := 0;
  l jsonb; r record;
  v_rate numeric := coalesce(p_fx_rate, 1);
begin
  if p_id is not null then
    select * into b from public.purchase_bills where id = p_id for update;
    if b.id is null then raise exception 'Bill not found'; end if;
    if b.status <> 'draft' then raise exception 'Only draft bills can be changed'; end if;
    p_company := b.company_id;
  end if;
  if not private.has_role(p_company, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Only owners, admins and accountants can enter supplier bills';
  end if;
  select * into co from public.companies where id = p_company;
  if not exists (select 1 from public.crm_accounts where id = p_supplier and company_id = p_company) then
    raise exception 'Pick the supplier';
  end if;
  if p_currency = co.base_currency then v_rate := 1; end if;
  if v_rate <= 0 then raise exception 'Exchange rate must be more than zero'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Lines must be a list'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into r from private.bill_line_values(p_company, l);
    v_sub := v_sub + r.v_sub;
    v_tax := v_tax + r.v_tax;
  end loop;

  if p_id is null then
    insert into public.purchase_bills (company_id, supplier_id, supplier_ref, bill_date, due_date, currency, fx_rate, paid_from_account_id, notes, draft_lines, subtotal, vat_total, total)
    values (p_company, p_supplier, nullif(trim(p_supplier_ref), ''), coalesce(p_bill_date, current_date), p_due_date, coalesce(p_currency, co.base_currency), v_rate,
            p_paid_from, nullif(trim(p_notes), ''), coalesce(p_lines, '[]'::jsonb), v_sub, v_tax, v_sub + v_tax)
    returning * into b;
  else
    update public.purchase_bills
       set supplier_id = p_supplier, supplier_ref = nullif(trim(p_supplier_ref), ''), bill_date = coalesce(p_bill_date, bill_date), due_date = p_due_date,
           currency = coalesce(p_currency, currency), fx_rate = v_rate, paid_from_account_id = p_paid_from, notes = nullif(trim(p_notes), ''),
           draft_lines = coalesce(p_lines, '[]'::jsonb), subtotal = v_sub, vat_total = v_tax, total = v_sub + v_tax
     where id = p_id
    returning * into b;
  end if;
  return b.id;
end $$;

create function public.discard_bill(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.purchase_bills;
begin
  select * into b from public.purchase_bills where id = p_id for update;
  if b.id is null or not private.has_role(b.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bill not found or your role can''t change bills';
  end if;
  if b.status <> 'draft' then raise exception 'Only drafts can be discarded; void a posted bill instead'; end if;
  update public.purchase_bills set status = 'void', void_reason = 'Draft discarded' where id = p_id;
end $$;

-- ---------- post ----------
create function public.post_bill(p_id uuid)
returns public.purchase_bills language plpgsql security definer set search_path = '' as $$
declare
  b public.purchase_bills;
  co public.companies;
  s public.crm_accounts;
  l jsonb;
  r record;
  v_no int := 0;
  v_vat_vendor boolean;
  v_sub numeric; v_tax numeric; v_base numeric; v_base_tax numeric;
  v_lines jsonb := '[]'::jsonb;
  v_vat_total numeric := 0;
  v_credit_total numeric := 0;
  v_sub_sum numeric := 0; v_tax_sum numeric := 0;
  v_account uuid; v_type public.account_type; v_system text;
  p public.products;
  u public.inventory_units;
  v_qty numeric;
  v_journal uuid;
  v_credit_account uuid;
  v_desc text;
  v_cost_ids uuid[] := '{}';
  v_move_ids uuid[] := '{}';
  v_id uuid;
begin
  select * into b from public.purchase_bills where id = p_id for update;
  if b.id is null or not private.has_role(b.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bill not found or your role can''t post bills';
  end if;
  if b.status <> 'draft' then raise exception 'This bill is already %', b.status; end if;
  select * into co from public.companies where id = b.company_id;
  select * into s from public.crm_accounts where id = b.supplier_id;
  v_vat_vendor := nullif(trim(coalesce(co.vat_no, '')), '') is not null;
  if jsonb_array_length(b.draft_lines) = 0 then raise exception 'Add at least one line'; end if;
  if b.currency = co.base_currency and b.fx_rate <> 1 then raise exception 'Bills in % use a rate of 1', co.base_currency; end if;

  if b.paid_from_account_id is not null then
    if not exists (select 1 from public.accounts where id = b.paid_from_account_id and company_id = b.company_id and type in ('asset', 'liability') and is_active) then
      raise exception 'Pick the bank or card account the expense was paid from';
    end if;
    v_credit_account := b.paid_from_account_id;
  else
    v_credit_account := private.rule_account(b.company_id, 'supplier_bill', 'payable');
  end if;

  b.number := private.next_doc_number(b.company_id, case when b.paid_from_account_id is null then 'purchase_bill' else 'expense' end,
                                      case when b.paid_from_account_id is null then 'BILL' else 'EXP' end);

  perform set_config('kageflow.system', 'on', true);
  for l in select * from jsonb_array_elements(b.draft_lines) loop
    v_no := v_no + 1;
    select * into r from private.bill_line_values(b.company_id, l);
    v_sub := r.v_sub; v_tax := r.v_tax;
    v_qty := coalesce(private.safe_numeric(l ->> 'quantity'), 0);
    if v_qty <= 0 then raise exception 'Line %: quantity must be more than zero', v_no; end if;
    if v_sub < 0 or v_tax < 0 then raise exception 'Line %: amounts cannot be negative', v_no; end if;
    v_base := round(v_sub * b.fx_rate, 2);
    v_base_tax := round(v_tax * b.fx_rate, 2);
    if not v_vat_vendor then
      v_base := v_base + v_base_tax;   -- not a VAT vendor: VAT is part of the cost
      v_base_tax := 0;
    end if;
    v_desc := coalesce(nullif(trim(l ->> 'description'), ''), 'Line ' || v_no);

    if l ->> 'kind' = 'account' then
      select id, type, system_key into v_account, v_type, v_system from public.accounts
       where id = nullif(l ->> 'account_id', '')::uuid and company_id = b.company_id and is_active;
      if v_account is null then raise exception 'Line %: pick the expense or asset account', v_no; end if;
      if v_type not in ('expense', 'asset') or v_system in ('bank', 'receivables', 'vat_input', 'inventory') then
        raise exception 'Line %: use an expense or asset account (stock and vehicles have their own line types)', v_no;
      end if;
      insert into public.purchase_bill_lines (company_id, bill_id, line_no, kind, account_id, description, quantity, unit_price, tax_rate_id, line_subtotal, line_tax, line_total, base_amount, base_tax)
      values (b.company_id, b.id, v_no, 'account', v_account, v_desc, v_qty, coalesce(private.safe_numeric(l ->> 'unit_price'), 0),
              nullif(l ->> 'tax_rate_id', '')::uuid, v_sub, v_tax, v_sub + v_tax, v_base, v_base_tax);

    elsif l ->> 'kind' = 'stock' then
      select * into p from public.products where id = nullif(l ->> 'product_id', '')::uuid and company_id = b.company_id for update;
      if p.id is null then raise exception 'Line %: pick the stock item', v_no; end if;
      if p.tracking <> 'stock' then raise exception 'Line %: % is not counted in stock', v_no, p.name; end if;
      v_account := private.system_account(b.company_id, 'inventory');
      insert into public.purchase_bill_lines (company_id, bill_id, line_no, kind, account_id, product_id, description, quantity, unit_price, tax_rate_id, line_subtotal, line_tax, line_total, base_amount, base_tax)
      values (b.company_id, b.id, v_no, 'stock', v_account, p.id, v_desc, v_qty, coalesce(private.safe_numeric(l ->> 'unit_price'), 0),
              nullif(l ->> 'tax_rate_id', '')::uuid, v_sub, v_tax, v_sub + v_tax, v_base, v_base_tax);
      insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, reference, bill_id)
      values (b.company_id, p.id, 'receipt', v_qty, round(v_base / v_qty, 4), 'Bill ' || b.number, b.id)
      returning id into v_id;
      v_move_ids := v_move_ids || v_id;
      update public.products
         set avg_cost = case when greatest(qty_on_hand, 0) + v_qty > 0
                             then round((greatest(qty_on_hand, 0) * avg_cost + v_base) / (greatest(qty_on_hand, 0) + v_qty), 4) else avg_cost end,
             qty_on_hand = qty_on_hand + v_qty
       where id = p.id;

    elsif l ->> 'kind' = 'vehicle' then
      select * into u from public.inventory_units where id = nullif(l ->> 'unit_id', '')::uuid and company_id = b.company_id;
      if u.id is null then raise exception 'Line %: pick the vehicle', v_no; end if;
      if u.status in ('sold', 'written_off') then
        raise exception 'Line %: vehicle % is already %; put this cost on an expense account instead', v_no, u.serial_no, u.status;
      end if;
      v_account := private.system_account(b.company_id, 'inventory');
      insert into public.purchase_bill_lines (company_id, bill_id, line_no, kind, account_id, unit_id, cost_kind, description, quantity, unit_price, tax_rate_id, line_subtotal, line_tax, line_total, base_amount, base_tax)
      values (b.company_id, b.id, v_no, 'vehicle', v_account, u.id, coalesce(nullif(l ->> 'cost_kind', ''), 'other')::public.unit_cost_kind, v_desc, v_qty,
              coalesce(private.safe_numeric(l ->> 'unit_price'), 0), nullif(l ->> 'tax_rate_id', '')::uuid, v_sub, v_tax, v_sub + v_tax, v_base, v_base_tax);
      if v_base > 0 then
        insert into public.unit_costs (company_id, unit_id, kind, description, cost_date, amount, vat_amount, paid_from_account_id, supplier_account_id, reference, bill_id)
        values (b.company_id, u.id, coalesce(nullif(l ->> 'cost_kind', ''), 'other')::public.unit_cost_kind, v_desc, b.bill_date, v_base, v_base_tax,
                v_credit_account, b.supplier_id, coalesce(b.supplier_ref, b.number), b.id)
        returning id into v_id;
        v_cost_ids := v_cost_ids || v_id;
      end if;
    else
      raise exception 'Line %: unknown line type', v_no;
    end if;

    if v_base > 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_account, 'debit', v_base, 'description', v_desc);
    end if;
    v_vat_total := v_vat_total + v_base_tax;
    v_credit_total := v_credit_total + v_base + v_base_tax;
    v_sub_sum := v_sub_sum + v_sub;
    v_tax_sum := v_tax_sum + v_tax;
  end loop;

  if v_credit_total <= 0 then raise exception 'The bill has no value'; end if;
  if v_vat_total > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(b.company_id, 'supplier_bill', 'vat'), 'debit', v_vat_total, 'description', 'VAT on ' || coalesce(b.supplier_ref, b.number));
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', v_credit_account, 'credit', v_credit_total, 'description', s.name);

  v_journal := public.post_document(b.company_id, 'supplier_bill', b.id, b.bill_date,
    case when b.paid_from_account_id is null then 'Bill ' else 'Expense ' end || b.number || ' - ' || s.name || coalesce(' (' || b.supplier_ref || ')', ''),
    v_lines, b.currency, b.fx_rate);

  update public.unit_costs set journal_id = v_journal where id = any (v_cost_ids);
  update public.stock_movements set journal_id = v_journal where id = any (v_move_ids);
  update public.purchase_bills
     set status = 'posted', number = b.number, journal_id = v_journal, posted_at = now(),
         subtotal = v_sub_sum, vat_total = v_tax_sum, total = v_sub_sum + v_tax_sum,
         amount_paid = case when paid_from_account_id is not null then v_sub_sum + v_tax_sum else 0 end,
         due_date = coalesce(due_date, case when paid_from_account_id is null then bill_date + 30 else bill_date end)
   where id = b.id
  returning * into b;
  perform set_config('kageflow.system', 'off', true);
  return b;
end $$;

-- ---------- void a posted bill ----------
create function public.void_bill(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.purchase_bills;
  l record;
  v_rev uuid;
  v_qoh numeric;
begin
  select * into b from public.purchase_bills where id = p_id for update;
  if b.id is null or not private.has_role(b.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bill not found or your role can''t void bills';
  end if;
  if b.status <> 'posted' then raise exception 'Only posted bills can be voided'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for voiding'; end if;
  if b.paid_from_account_id is null and b.amount_paid > 0 then
    raise exception 'Bill % has payments against it; reverse those payments first', b.number;
  end if;

  perform set_config('kageflow.system', 'on', true);
  for l in select * from public.purchase_bill_lines where bill_id = b.id order by line_no loop
    if l.kind = 'stock' then
      select qty_on_hand into v_qoh from public.products where id = l.product_id for update;
      if v_qoh < l.quantity then
        raise exception 'Only % left of the stock on this bill; it has been sold. Use a stock count instead', trim(to_char(v_qoh, 'FM999999990.####'));
      end if;
      update public.products
         set avg_cost = case when qty_on_hand - l.quantity > 0 then greatest(round((qty_on_hand * avg_cost - l.base_amount) / (qty_on_hand - l.quantity), 4), 0) else avg_cost end,
             qty_on_hand = qty_on_hand - l.quantity
       where id = l.product_id;
      insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, reference, bill_id)
      values (b.company_id, l.product_id, 'adjustment', -l.quantity, round(l.base_amount / l.quantity, 4), 'Bill ' || b.number || ' voided', b.id);
    elsif l.kind = 'vehicle' then
      if exists (select 1 from public.inventory_units where id = l.unit_id and status in ('sold', 'written_off')) then
        raise exception 'A vehicle on this bill is already sold, so its cost is final';
      end if;
    end if;
  end loop;

  v_rev := public.reverse_journal(b.journal_id, current_date, 'Bill ' || b.number || ' voided: ' || trim(p_reason));
  update public.unit_costs set reversal_journal_id = v_rev where bill_id = b.id and reversal_journal_id is null;
  update public.purchase_bills set status = 'void', void_journal_id = v_rev, void_reason = trim(p_reason), amount_paid = 0 where id = b.id;
  perform set_config('kageflow.system', 'off', true);
  return v_rev;
end $$;

-- vehicle costs that came from a bill are reversed by voiding the bill
create or replace function public.reverse_unit_cost(p_cost uuid, p_reason text default null)
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
  if c.bill_id is not null then
    raise exception 'This cost came from a supplier bill; void the bill instead';
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

-- ---------- supplier payments ----------
-- p_allocations: [{"bill_id": "...", "amount": 1000}]; the payment amount is their sum
create function public.pay_supplier(
  p_supplier uuid,
  p_bank_account uuid,
  p_allocations jsonb,
  p_date date default current_date,
  p_currency char(3) default 'ZAR',
  p_fx_rate numeric default 1,
  p_reference text default null,
  p_bank_charges numeric default 0
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.crm_accounts;
  co public.companies;
  b public.purchase_bills;
  al jsonb;
  v_rate numeric := coalesce(p_fx_rate, 1);
  v_amt numeric;
  v_total numeric := 0;
  v_payable_base numeric := 0;
  v_bank_base numeric;
  v_diff numeric;
  v_id uuid;
  v_number text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_charges numeric := round(coalesce(p_bank_charges, 0), 2);
  v_payable uuid;
begin
  select * into s from public.crm_accounts where id = p_supplier;
  if s.id is null or not private.has_role(s.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Supplier not found, or only owners, admins and accountants can pay suppliers';
  end if;
  select * into co from public.companies where id = s.company_id;
  if p_currency = co.base_currency then v_rate := 1; end if;
  if v_rate <= 0 then raise exception 'Exchange rate must be more than zero'; end if;
  if v_charges < 0 then raise exception 'Bank charges cannot be negative'; end if;
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = s.company_id and type in ('asset', 'liability') and is_active) then
    raise exception 'Pick the bank account the money came from';
  end if;
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'Choose at least one bill to pay';
  end if;

  v_number := private.next_doc_number(s.company_id, 'supplier_payment', 'SPAY');
  insert into public.supplier_payments (company_id, number, supplier_id, payment_date, currency, fx_rate, amount, bank_charges, bank_account_id, reference)
  values (s.company_id, v_number, s.id, coalesce(p_date, current_date), p_currency, v_rate, 0.01, v_charges, p_bank_account, nullif(trim(p_reference), ''))
  returning id into v_id;

  for al in select * from jsonb_array_elements(p_allocations) loop
    v_amt := round(coalesce(private.safe_numeric(al ->> 'amount'), 0), 2);
    continue when v_amt <= 0;
    select * into b from public.purchase_bills where id = nullif(al ->> 'bill_id', '')::uuid and company_id = s.company_id for update;
    if b.id is null or b.status <> 'posted' or b.supplier_id <> s.id then raise exception 'A chosen bill is not a posted bill from %', s.name; end if;
    if b.currency <> p_currency then raise exception 'Bill % is in %; pay it in the same currency', b.number, b.currency; end if;
    if v_amt > b.amount_due then raise exception 'Paying % on % but only % is owed', v_amt, b.number, b.amount_due; end if;
    v_payable_base := v_payable_base + round(v_amt * b.fx_rate, 2);
    v_total := v_total + v_amt;
    insert into public.supplier_payment_allocations (company_id, payment_id, bill_id, amount, fx_difference)
    values (s.company_id, v_id, b.id, v_amt, round(v_amt * b.fx_rate, 2) - round(v_amt * v_rate, 2));
    perform set_config('kageflow.system', 'on', true);
    update public.purchase_bills set amount_paid = amount_paid + v_amt where id = b.id;
    perform set_config('kageflow.system', 'off', true);
  end loop;
  if v_total <= 0 then raise exception 'Enter an amount to pay on at least one bill'; end if;

  v_bank_base := round(v_total * v_rate, 2);
  v_diff := v_payable_base - v_bank_base;
  v_payable := private.rule_account(s.company_id, 'supplier_payment', 'payable');
  v_lines := v_lines || jsonb_build_object('account_id', v_payable, 'debit', v_payable_base, 'description', s.name);
  if v_diff < 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(s.company_id, 'fx_loss'), 'debit', -v_diff, 'description', 'Exchange loss on ' || v_number);
  end if;
  if v_charges > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(s.company_id, 'supplier_payment', 'bank_charges'), 'debit', v_charges, 'description', 'Bank charges');
  end if;
  v_lines := v_lines || jsonb_build_object('account_id', p_bank_account, 'credit', v_bank_base + v_charges, 'description', coalesce(nullif(trim(p_reference), ''), s.name));
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(s.company_id, 'fx_gain'), 'credit', v_diff, 'description', 'Exchange gain on ' || v_number);
  end if;

  v_journal := public.post_document(s.company_id, 'supplier_payment', v_id, coalesce(p_date, current_date), 'Payment ' || v_number || ' to ' || s.name, v_lines, p_currency, v_rate);
  update public.supplier_payments set amount = v_total, journal_id = v_journal where id = v_id;
  return v_id;
end $$;

create function public.reverse_supplier_payment(p_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sp public.supplier_payments;
  v_rev uuid;
begin
  select * into sp from public.supplier_payments where id = p_id for update;
  if sp.id is null or not private.has_role(sp.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Payment not found, or only owners, admins and accountants can reverse payments';
  end if;
  if sp.reversal_journal_id is not null then raise exception 'Payment % is already reversed', sp.number; end if;
  v_rev := public.reverse_journal(sp.journal_id, current_date, coalesce(nullif(trim(p_reason), ''), 'Supplier payment reversed'));
  perform set_config('kageflow.system', 'on', true);
  update public.purchase_bills b set amount_paid = b.amount_paid - a.amount
    from public.supplier_payment_allocations a where a.payment_id = sp.id and a.bill_id = b.id;
  update public.supplier_payments set reversal_journal_id = v_rev where id = sp.id;
  perform set_config('kageflow.system', 'off', true);
  return v_rev;
end $$;

-- ---------- capital accounts flag for new companies ----------
create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
  perform private.seed_catalog(p_company);
  update public.accounts set is_capital = true where company_id = p_company and code in ('1500', '1600') and system_key is null;
end $$;

-- ---------- grants ----------
revoke all on function public.save_bill(uuid, uuid, uuid, text, date, date, char, numeric, uuid, text, jsonb) from public, anon;
revoke all on function public.discard_bill(uuid) from public, anon;
revoke all on function public.post_bill(uuid) from public, anon;
revoke all on function public.void_bill(uuid, text) from public, anon;
revoke all on function public.pay_supplier(uuid, uuid, jsonb, date, char, numeric, text, numeric) from public, anon;
revoke all on function public.reverse_supplier_payment(uuid, text) from public, anon;
revoke all on function private.bill_line_values(uuid, jsonb) from public;
grant execute on function public.save_bill(uuid, uuid, uuid, text, date, date, char, numeric, uuid, text, jsonb) to authenticated;
grant execute on function public.discard_bill(uuid) to authenticated;
grant execute on function public.post_bill(uuid) to authenticated;
grant execute on function public.void_bill(uuid, text) to authenticated;
grant execute on function public.pay_supplier(uuid, uuid, jsonb, date, char, numeric, text, numeric) to authenticated;
grant execute on function public.reverse_supplier_payment(uuid, text) to authenticated;

-- ---------- RLS: read for members, writes only through the functions above ----------
alter table public.purchase_bills enable row level security;
alter table public.purchase_bill_lines enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;
create policy purchase_bills_select on public.purchase_bills for select to authenticated using (private.is_member(company_id));
create policy purchase_bill_lines_select on public.purchase_bill_lines for select to authenticated using (private.is_member(company_id));
create policy supplier_payments_select on public.supplier_payments for select to authenticated using (private.is_member(company_id));
create policy supplier_payment_allocations_select on public.supplier_payment_allocations for select to authenticated using (private.is_member(company_id));
revoke all on public.purchase_bills, public.purchase_bill_lines, public.supplier_payments, public.supplier_payment_allocations from anon;
revoke insert, update on public.purchase_bills, public.purchase_bill_lines, public.supplier_payments, public.supplier_payment_allocations from authenticated;

create trigger audit_purchase_bills after insert or update or delete on public.purchase_bills for each row execute function private.audit_row();
create trigger audit_purchase_bill_lines after insert or update or delete on public.purchase_bill_lines for each row execute function private.audit_row();
create trigger audit_supplier_payments after insert or update or delete on public.supplier_payments for each row execute function private.audit_row();
create trigger audit_supplier_payment_allocations after insert or update or delete on public.supplier_payment_allocations for each row execute function private.audit_row();
