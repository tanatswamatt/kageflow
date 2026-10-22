-- Kageflow 0014: vehicle finance applications and trade-ins
-- (payment methods trade_in and bank_payout were added in their own migration first)
-- * A finance application holds the buyer's details once, and is sent to several banks; each bank's answer is tracked
-- * Bank payouts are recorded as payments on the customer's order and settle the invoice like any deposit
-- * Accepting a trade-in puts the car into stock at its cost, credits the customer, and records any settlement owed to their bank
-- * Trade-ins from non-VAT vendors claim notional input tax (15/115 of the allowance) when the company is a VAT vendor

-- ---------- settlement account ----------
insert into public.accounts (company_id, code, name, type, system_key, is_system)
select c.id, '2350', 'Trade-in settlements payable', 'liability', 'tradein_settlements', true
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and a.system_key = 'tradein_settlements')
   and not exists (select 1 from public.accounts a where a.company_id = c.id and a.code = '2350');

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
  perform private.seed_catalog(p_company);
  update public.accounts set is_capital = true where company_id = p_company and code in ('1500', '1600') and system_key is null;
  insert into public.accounts (company_id, code, name, type, system_key, is_system)
  values (p_company, '2350', 'Trade-in settlements payable', 'liability', 'tradein_settlements', true)
  on conflict do nothing;
end $$;

-- ---------- finance applications ----------
create table public.finance_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  account_id uuid not null,
  order_id uuid,
  deal_id uuid,
  unit_id uuid,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'declined', 'contracted', 'paid_out', 'cancelled')),
  -- applicant
  first_name text, last_name text, id_number text, email text, phone text,
  marital_status text, dependants int check (dependants >= 0),
  address text, residential_status text, years_at_address numeric(5, 1),
  employer text, occupation text, employment_type text, employed_since date,
  gross_income numeric(18, 2) check (gross_income >= 0),
  net_income numeric(18, 2) check (net_income >= 0),
  other_income numeric(18, 2) check (other_income >= 0),
  expenses numeric(18, 2) check (expenses >= 0),
  -- deal
  purchase_price numeric(18, 2) check (purchase_price >= 0),
  deposit numeric(18, 2) not null default 0 check (deposit >= 0),
  trade_in_credit numeric(18, 2) not null default 0 check (trade_in_credit >= 0),
  extras numeric(18, 2) not null default 0 check (extras >= 0),
  term_months int check (term_months between 6 and 96),
  balloon_pct numeric(5, 2) not null default 0 check (balloon_pct between 0 and 60),
  est_rate numeric(6, 3) check (est_rate between 0 and 50),
  documents jsonb not null default '{}'::jsonb,
  consent_at timestamptz,
  consent_text text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, order_id) references public.sales_docs (company_id, id) on delete set null (order_id),
  foreign key (company_id, deal_id) references public.crm_deals (company_id, id) on delete set null (deal_id),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id) on delete set null (unit_id)
);
create index finance_applications_company_idx on public.finance_applications (company_id, status, created_at desc);
create trigger finance_applications_touch before update on public.finance_applications for each row execute function private.touch_updated_at();

create function private.finance_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null then new.number := private.next_doc_number(new.company_id, 'finance_application', 'FIN'); end if;
  return new;
end $$;
create trigger finance_applications_number before insert on public.finance_applications for each row execute function private.finance_number();

create table public.finance_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  application_id uuid not null,
  bank text not null check (length(trim(bank)) > 0),
  reference text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'counter_offer', 'declined', 'contracted', 'paid_out', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  approved_amount numeric(18, 2) check (approved_amount >= 0),
  rate numeric(6, 3) check (rate between 0 and 50),
  term_months int check (term_months between 6 and 96),
  balloon_amount numeric(18, 2) check (balloon_amount >= 0),
  instalment numeric(18, 2) check (instalment >= 0),
  conditions text,
  payout_amount numeric(18, 2) check (payout_amount >= 0),
  payout_date date,
  payment_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, application_id) references public.finance_applications (company_id, id) on delete cascade,
  foreign key (company_id, payment_id) references public.customer_payments (company_id, id)
);
create index finance_submissions_app_idx on public.finance_submissions (company_id, application_id);
create trigger finance_submissions_touch before update on public.finance_submissions for each row execute function private.touch_updated_at();

-- the application's status follows the best bank answer
create function private.finance_rollup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app uuid := coalesce(new.application_id, old.application_id);
  v_best text;
begin
  select s.status into v_best from public.finance_submissions s where s.application_id = v_app
   order by array_position(array['paid_out', 'contracted', 'approved', 'counter_offer', 'submitted', 'declined', 'withdrawn'], s.status) limit 1;
  update public.finance_applications a
     set status = case
       when a.status = 'cancelled' then 'cancelled'
       when v_best is null then 'draft'
       when v_best in ('approved', 'counter_offer') then 'approved'
       when v_best = 'withdrawn' then 'declined'
       else v_best end
   where a.id = v_app;
  return null;
end $$;
create trigger finance_submissions_rollup after insert or update or delete on public.finance_submissions for each row execute function private.finance_rollup();

alter table public.finance_applications enable row level security;
alter table public.finance_submissions enable row level security;
-- personal and income details: not visible to viewers
create policy finance_applications_select on public.finance_applications for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_applications_insert on public.finance_applications for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_applications_update on public.finance_applications for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_submissions_select on public.finance_submissions for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_submissions_insert on public.finance_submissions for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_submissions_update on public.finance_submissions for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy finance_submissions_remove on public.finance_submissions for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
revoke all on public.finance_applications, public.finance_submissions from anon;

-- Bank pays the dealer: a payment on the customer's order, linked to the bank's approval
create function public.record_finance_payout(p_submission uuid, p_amount numeric, p_bank_account uuid, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.finance_submissions;
  a public.finance_applications;
  v_pay uuid;
begin
  select * into s from public.finance_submissions where id = p_submission for update;
  if s.id is null or not private.has_role(s.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bank answer not found, or only owners, admins and accountants can record payouts';
  end if;
  if s.payment_id is not null then raise exception 'This payout is already recorded'; end if;
  if s.status not in ('approved', 'counter_offer', 'contracted') then raise exception 'Only an approved or contracted deal can pay out'; end if;
  select * into a from public.finance_applications where id = s.application_id;
  v_pay := public.record_customer_payment(a.account_id, p_amount, p_bank_account, 'ZAR', 1, p_date, 'bank_payout',
             left(s.bank || ' payout' || coalesce(' ' || s.reference, ''), 200), a.order_id, '[]'::jsonb);
  update public.finance_submissions set status = 'paid_out', payout_amount = p_amount, payout_date = p_date, payment_id = v_pay, decided_at = coalesce(decided_at, now()) where id = s.id;
  return v_pay;
end $$;

-- ---------- trade-ins ----------
create table public.trade_ins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  account_id uuid not null,
  order_id uuid,
  deal_id uuid,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'cancelled')),
  vin text,
  make text, model text, variant text,
  year int check (year between 1950 and 2100),
  mileage_km int check (mileage_km >= 0),
  colour text,
  registration text,
  condition_notes text,
  valuation numeric(18, 2) check (valuation >= 0),
  allowance numeric(18, 2) check (allowance >= 0),
  settlement_amount numeric(18, 2) not null default 0 check (settlement_amount >= 0),
  settlement_bank text,
  settlement_ref text,
  seller_is_vendor boolean not null default false,
  unit_id uuid,
  payment_id uuid,
  journal_id uuid,
  reversal_journal_id uuid,
  accepted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, order_id) references public.sales_docs (company_id, id) on delete set null (order_id),
  foreign key (company_id, deal_id) references public.crm_deals (company_id, id) on delete set null (deal_id),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id),
  foreign key (company_id, payment_id) references public.customer_payments (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index trade_ins_company_idx on public.trade_ins (company_id, status, created_at desc);
create trigger trade_ins_touch before update on public.trade_ins for each row execute function private.touch_updated_at();

create function private.trade_in_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null then new.number := private.next_doc_number(new.company_id, 'trade_in', 'TI'); end if;
  return new;
end $$;
create trigger trade_ins_number before insert on public.trade_ins for each row execute function private.trade_in_number();

-- once accepted, the money side is frozen; only the functions below change it
create function private.guard_trade_in()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_system() then return new; end if;
  if old.status <> 'draft' then
    raise exception 'Trade-in % is %; undo it to make changes', old.number, old.status;
  end if;
  if new.status <> 'draft' or new.unit_id is not null or new.payment_id is not null or new.journal_id is not null then
    raise exception 'Accept a trade-in with the Accept button';
  end if;
  return new;
end $$;
create trigger trade_ins_guard before update on public.trade_ins for each row execute function private.guard_trade_in();

alter table public.unit_costs add column trade_in_id uuid;
alter table public.unit_costs add foreign key (company_id, trade_in_id) references public.trade_ins (company_id, id);

create function public.accept_trade_in(p_id uuid, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trade_ins;
  co public.companies;
  a public.crm_accounts;
  v_vendor boolean;
  v_vat numeric := 0;
  v_cost numeric;
  v_credit numeric;
  v_unit uuid;
  v_vehicle uuid;
  v_pay uuid;
  v_journal uuid;
  v_lines jsonb;
  v_serial text;
  v_inventory uuid;
begin
  select * into t from public.trade_ins where id = p_id for update;
  if t.id is null or not private.has_role(t.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Trade-in not found or your role can''t accept trade-ins';
  end if;
  if t.status <> 'draft' then raise exception 'This trade-in is already %', t.status; end if;
  if t.allowance is null or t.allowance <= 0 then raise exception 'Enter the trade-in allowance agreed with the customer'; end if;
  if t.settlement_amount > t.allowance then
    raise exception 'The settlement (R%) is more than the allowance (R%): negative equity. Add the shortfall as a line on the customer''s invoice and enter a settlement of no more than the allowance', t.settlement_amount, t.allowance;
  end if;
  if nullif(trim(coalesce(t.make, '')), '') is null then raise exception 'Enter at least the make of the trade-in'; end if;
  if t.order_id is not null and not exists (select 1 from public.sales_docs where id = t.order_id and doc_type = 'order' and status <> 'draft' and currency = 'ZAR') then
    raise exception 'Link the trade-in to a confirmed order in rand, or to none';
  end if;

  select * into co from public.companies where id = t.company_id;
  select * into a from public.crm_accounts where id = t.account_id;
  v_vendor := nullif(trim(coalesce(co.vat_no, '')), '') is not null;
  if v_vendor then
    v_vat := round(t.allowance * 15 / 115, 2);   -- notional input tax (private seller) or input tax on the seller's tax invoice
  end if;
  v_cost := t.allowance - v_vat;
  v_credit := t.allowance - t.settlement_amount;
  v_inventory := private.system_account(t.company_id, 'inventory');
  select id into v_vehicle from public.products where company_id = t.company_id and tracking = 'serial' order by (sku = 'VEHICLE') desc, created_at limit 1;
  v_serial := coalesce(nullif(upper(regexp_replace(coalesce(t.vin, ''), '\s', '', 'g')), ''), 'TBC-' || upper(substr(md5(t.id::text), 1, 10)));
  if exists (select 1 from public.inventory_units where company_id = t.company_id and serial_no = v_serial) then
    raise exception 'A vehicle with VIN % is already in stock', v_serial;
  end if;

  perform set_config('kageflow.system', 'on', true);
  insert into public.inventory_units (company_id, product_id, serial_no, vin_confirmed, make, model, variant, year, colour, mileage_km, is_second_hand,
                                      status, supplier_account_id, acquired_on, notes)
  values (t.company_id, v_vehicle, v_serial, length(v_serial) >= 11 and v_serial !~ '^TBC-', t.make, t.model, t.variant, t.year, t.colour, t.mileage_km, true,
          'in_stock', t.account_id, p_date, left(concat_ws(E'\n', 'Trade-in ' || t.number || ' from ' || a.name, t.registration, t.condition_notes), 2000))
  returning id into v_unit;

  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_inventory, 'debit', v_cost, 'description', 'Trade-in ' || t.number || ': ' || concat_ws(' ', t.year, t.make, t.model)));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(t.company_id, 'vat_input'), 'debit', v_vat,
      'description', case when t.seller_is_vendor then 'Input tax on trade-in ' else 'Notional input tax on trade-in ' end || t.number);
  end if;
  if v_credit > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(t.company_id, 'customer_deposits'), 'credit', v_credit, 'description', 'Trade-in credit for ' || a.name);
  end if;
  if t.settlement_amount > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.system_account(t.company_id, 'tradein_settlements'), 'credit', t.settlement_amount,
      'description', 'Settlement owed to ' || coalesce(t.settlement_bank, 'the customer''s bank') || coalesce(' ' || t.settlement_ref, ''));
  end if;
  v_journal := public.post_document(t.company_id, 'trade_in', t.id, p_date, 'Trade-in ' || t.number || ' from ' || a.name, v_lines);

  insert into public.unit_costs (company_id, unit_id, kind, description, cost_date, amount, vat_amount, paid_from_account_id, supplier_account_id, reference, journal_id, trade_in_id)
  values (t.company_id, v_unit, 'purchase', 'Trade-in allowance', p_date, v_cost, v_vat, private.system_account(t.company_id, 'customer_deposits'), t.account_id, t.number, v_journal, t.id);

  if v_credit > 0 then
    insert into public.customer_payments (company_id, number, account_id, order_id, payment_date, currency, fx_rate, amount, bank_account_id, method, reference, journal_id)
    values (t.company_id, private.next_doc_number(t.company_id, 'customer_payment', 'PAY'), t.account_id, t.order_id, p_date, 'ZAR', 1, v_credit,
            v_inventory, 'trade_in', 'Trade-in ' || t.number, v_journal)
    returning id into v_pay;
  end if;

  update public.trade_ins set status = 'accepted', unit_id = v_unit, payment_id = v_pay, journal_id = v_journal, accepted_at = now() where id = t.id;
  perform set_config('kageflow.system', 'off', true);
  return jsonb_build_object('unit_id', v_unit, 'payment_id', v_pay, 'credit', v_credit, 'vat_claimed', v_vat, 'cost', v_cost);
end $$;

create function public.undo_trade_in(p_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.trade_ins;
  u public.inventory_units;
  p public.customer_payments;
  v_rev uuid;
begin
  select * into t from public.trade_ins where id = p_id for update;
  if t.id is null or not private.has_role(t.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Trade-in not found, or only owners, admins and accountants can undo trade-ins';
  end if;
  if t.status <> 'accepted' then raise exception 'Only accepted trade-ins can be undone'; end if;
  select * into u from public.inventory_units where id = t.unit_id for update;
  if u.status in ('sold', 'reserved') or exists (select 1 from public.sales_doc_lines l join public.sales_docs d on d.id = l.doc_id where l.unit_id = u.id and d.status <> 'draft') then
    raise exception 'The trade-in vehicle is already on a sale; it can''t be undone';
  end if;
  if exists (select 1 from public.unit_costs c where c.unit_id = u.id and c.trade_in_id is null and c.reversal_journal_id is null) then
    raise exception 'Reverse the other costs posted on the trade-in vehicle first';
  end if;
  if t.payment_id is not null then
    select * into p from public.customer_payments where id = t.payment_id;
    if p.amount_allocated > 0 then raise exception 'The trade-in credit is already applied to an invoice; credit that invoice first'; end if;
  end if;
  v_rev := public.reverse_journal(t.journal_id, current_date, coalesce(nullif(trim(p_reason), ''), 'Trade-in undone'));
  perform set_config('kageflow.system', 'on', true);
  if t.payment_id is not null then update public.customer_payments set reversal_journal_id = v_rev where id = t.payment_id; end if;
  update public.unit_costs set reversal_journal_id = v_rev where trade_in_id = t.id;
  update public.inventory_units set status = 'written_off', is_published = false, notes = concat_ws(E'\n', notes, 'Trade-in undone: ' || coalesce(p_reason, '')) where id = u.id;
  update public.trade_ins set status = 'cancelled', reversal_journal_id = v_rev where id = t.id;
  perform set_config('kageflow.system', 'off', true);
  return v_rev;
end $$;

-- costs and payments created by a trade-in are only undone with the trade-in
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
  if c.bill_id is not null then raise exception 'This cost came from a supplier bill; void the bill instead'; end if;
  if c.trade_in_id is not null then raise exception 'This cost is the trade-in allowance; undo the trade-in instead'; end if;
  if c.reversal_journal_id is not null then raise exception 'This cost is already reversed'; end if;
  select * into u from public.inventory_units where id = c.unit_id;
  if u.status in ('sold', 'written_off') then raise exception 'Unit % is %; its costs are final', u.serial_no, u.status; end if;
  v_rev := public.reverse_journal(c.journal_id, current_date, coalesce(p_reason, 'Cost reversed'));
  update public.unit_costs set reversal_journal_id = v_rev where id = c.id;
  return v_rev;
end $$;

create or replace function public.reverse_customer_payment(p_payment uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v_rev uuid;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null or not private.has_role(p.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Payment not found, or only owners, admins and accountants can reverse payments';
  end if;
  if p.method = 'trade_in' then raise exception 'This credit came from a trade-in; undo the trade-in instead'; end if;
  if p.reversal_journal_id is not null then raise exception 'Payment % is already reversed', p.number; end if;
  if p.amount_allocated > 0 then raise exception 'Payment % is applied to invoices; credit those invoices first', p.number; end if;
  v_rev := public.reverse_journal(p.journal_id, current_date, coalesce(p_reason, 'Payment reversed'));
  perform set_config('kageflow.system', 'on', true);
  update public.customer_payments set reversal_journal_id = v_rev where id = p.id;
  update public.finance_submissions set payment_id = null, status = 'contracted', payout_amount = null, payout_date = null where payment_id = p.id;
  perform set_config('kageflow.system', 'off', true);
  return v_rev;
end $$;

alter table public.trade_ins enable row level security;
create policy trade_ins_select on public.trade_ins for select to authenticated using (private.is_member(company_id));
create policy trade_ins_insert on public.trade_ins for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) and status = 'draft');
create policy trade_ins_update on public.trade_ins for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
revoke all on public.trade_ins from anon;

revoke all on function public.record_finance_payout(uuid, numeric, uuid, date) from public, anon;
revoke all on function public.accept_trade_in(uuid, date) from public, anon;
revoke all on function public.undo_trade_in(uuid, text) from public, anon;
grant execute on function public.record_finance_payout(uuid, numeric, uuid, date) to authenticated;
grant execute on function public.accept_trade_in(uuid, date) to authenticated;
grant execute on function public.undo_trade_in(uuid, text) to authenticated;

create trigger audit_finance_applications after insert or update or delete on public.finance_applications for each row execute function private.audit_row();
create trigger audit_finance_submissions after insert or update or delete on public.finance_submissions for each row execute function private.audit_row();
create trigger audit_trade_ins after insert or update or delete on public.trade_ins for each row execute function private.audit_row();
