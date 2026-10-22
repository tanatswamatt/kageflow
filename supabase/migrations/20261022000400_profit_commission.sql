-- Kageflow 0015: profit per car, salesperson commission, finance house commission (DIC)
-- * Every sales document carries a salesperson (from its source document, the deal owner, or whoever created it)
-- * Issuing an invoice creates a pending commission from the salesperson's plan (% of gross profit, % of sale, or flat per car)
-- * Approving a commission accrues it: Dr Sales commission, Cr Commission payable; paying it clears the payable from the bank
-- * vehicle_profit shows each car's costs, sale, gross profit, add-on profit, finance commission, sales commission and net profit

-- ---------- accounts ----------
insert into public.accounts (company_id, code, name, type, system_key, is_system)
select c.id, x.code, x.name, x.type::public.account_type, x.key, true
  from public.companies c
  cross join (values ('6050', 'Sales commission', 'expense', 'commission_expense'),
                     ('2450', 'Commission payable', 'liability', 'commission_payable'),
                     ('4300', 'Finance and insurance commission', 'income', 'fi_income')) as x (code, name, type, key)
 where not exists (select 1 from public.accounts a where a.company_id = c.id and (a.system_key = x.key or a.code = x.code));

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
  perform private.seed_catalog(p_company);
  update public.accounts set is_capital = true where company_id = p_company and code in ('1500', '1600') and system_key is null;
  insert into public.accounts (company_id, code, name, type, system_key, is_system) values
    (p_company, '2350', 'Trade-in settlements payable', 'liability', 'tradein_settlements', true),
    (p_company, '6050', 'Sales commission', 'expense', 'commission_expense', true),
    (p_company, '2450', 'Commission payable', 'liability', 'commission_payable', true),
    (p_company, '4300', 'Finance and insurance commission', 'income', 'fi_income', true)
  on conflict do nothing;
end $$;

-- ---------- salesperson on documents ----------
alter table public.sales_docs add column salesperson_id uuid references auth.users (id) on delete set null;

create function private.sales_doc_salesperson()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.salesperson_id is null then
    new.salesperson_id := coalesce(
      (select s.salesperson_id from public.sales_docs s where s.id = new.source_doc_id),
      (select d.owner_id from public.crm_deals d where d.id = new.deal_id),
      (select auth.uid() where exists (select 1 from public.company_members m where m.company_id = new.company_id and m.user_id = auth.uid())));
  end if;
  return new;
end $$;
create trigger sales_docs_salesperson before insert on public.sales_docs for each row execute function private.sales_doc_salesperson();

-- ---------- commission plans and commissions ----------
create table public.commission_plans (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  basis text not null check (basis in ('gross_profit_pct', 'sale_pct', 'flat_per_car')),
  rate numeric(18, 4) not null check (rate >= 0),
  min_amount numeric(18, 2) not null default 0 check (min_amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  invoice_id uuid not null,
  user_id uuid not null references auth.users (id),
  basis text not null,
  rate numeric(18, 4) not null,
  sale_amount numeric(18, 2) not null,
  gross_profit numeric(18, 2) not null,
  amount numeric(18, 2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'cancelled')),
  note text,
  journal_id uuid,
  payment_journal_id uuid,
  reversal_journal_id uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, invoice_id) references public.sales_docs (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, payment_journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index commissions_company_idx on public.commissions (company_id, status, created_at desc);
create index commissions_invoice_idx on public.commissions (company_id, invoice_id);

-- commission from the salesperson's plan
create function private.commission_for_invoice(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.sales_docs;
  p public.commission_plans;
  v_sale numeric; v_cost numeric; v_units int; v_amt numeric;
begin
  select * into d from public.sales_docs where id = p_doc;
  select * into p from public.commission_plans where company_id = d.company_id and user_id = d.salesperson_id;
  if p.user_id is null then return; end if;
  select coalesce(sum(round(l.line_subtotal * d.fx_rate, 2)), 0), coalesce(sum(l.cost_amount), 0), count(l.unit_id)
    into v_sale, v_cost, v_units from public.sales_doc_lines l where l.doc_id = d.id;
  v_amt := case p.basis
    when 'gross_profit_pct' then round(greatest(v_sale - v_cost, 0) * p.rate / 100, 2)
    when 'sale_pct' then round(v_sale * p.rate / 100, 2)
    else round(p.rate * greatest(v_units, 1), 2) end;
  v_amt := greatest(v_amt, case when v_units > 0 then p.min_amount * v_units else p.min_amount end);
  if v_amt > 0 then
    insert into public.commissions (company_id, invoice_id, user_id, basis, rate, sale_amount, gross_profit, amount)
    values (d.company_id, d.id, d.salesperson_id, p.basis, p.rate, v_sale, v_sale - v_cost, v_amt);
  end if;
end $$;

-- When an invoice is issued: pending commission for its salesperson. When it is fully credited: cancel pending ones.
create function private.invoice_commission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doc_type <> 'invoice' or new.status <> 'issued' then return null; end if;
  if old.status <> 'issued' and new.salesperson_id is not null then
    perform private.commission_for_invoice(new.id);
  end if;
  if new.amount_credited >= new.total and old.amount_credited < old.total then
    update public.commissions set status = 'cancelled', note = 'Invoice fully credited'
     where invoice_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger sales_docs_commission after update of status, amount_credited on public.sales_docs for each row execute function private.invoice_commission();

create function public.approve_commissions(p_ids uuid[], p_date date default current_date)
returns int language plpgsql security definer set search_path = '' as $$
declare
  k public.commissions;
  v_n int := 0;
  v_j uuid;
begin
  for k in select * from public.commissions where id = any (p_ids) and status = 'pending' for update loop
    if not private.has_role(k.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
      raise exception 'Only owners, admins and accountants can approve commission';
    end if;
    v_j := public.post_document(k.company_id, 'commission', k.id, p_date,
      'Sales commission on ' || (select number from public.sales_docs where id = k.invoice_id),
      jsonb_build_array(
        jsonb_build_object('account_id', private.system_account(k.company_id, 'commission_expense'), 'debit', k.amount),
        jsonb_build_object('account_id', private.system_account(k.company_id, 'commission_payable'), 'credit', k.amount)));
    update public.commissions set status = 'approved', journal_id = v_j, approved_at = now() where id = k.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- one bank payment for several approved commissions
create function public.pay_commissions(p_ids uuid[], p_bank_account uuid, p_date date default current_date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_total numeric;
  v_j uuid;
begin
  select min(company_id::text)::uuid, sum(amount) into v_company, v_total from public.commissions where id = any (p_ids) and status = 'approved';
  if v_company is null then raise exception 'Choose approved commissions to pay'; end if;
  if exists (select 1 from public.commissions where id = any (p_ids) and (company_id <> v_company or status <> 'approved')) then
    raise exception 'Only approved commissions can be paid';
  end if;
  if not private.has_role(v_company, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Only owners, admins and accountants can pay commission';
  end if;
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = v_company and type in ('asset', 'liability') and is_active) then
    raise exception 'Pick the bank account it was paid from';
  end if;
  v_j := public.post_document(v_company, 'commission_payment', null, p_date, coalesce(nullif(trim(p_reference), ''), 'Commission paid'),
    jsonb_build_array(
      jsonb_build_object('account_id', private.system_account(v_company, 'commission_payable'), 'debit', v_total),
      jsonb_build_object('account_id', p_bank_account, 'credit', v_total, 'description', coalesce(nullif(trim(p_reference), ''), 'Commission'))));
  update public.commissions set status = 'paid', payment_journal_id = v_j, paid_at = now() where id = any (p_ids);
  return v_j;
end $$;

create function public.cancel_commission(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k public.commissions;
  v_rev uuid;
begin
  select * into k from public.commissions where id = p_id for update;
  if k.id is null or not private.has_role(k.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Commission not found, or only owners, admins and accountants can change commission';
  end if;
  if k.status = 'paid' then raise exception 'This commission is already paid'; end if;
  if k.status = 'cancelled' then return; end if;
  if k.status = 'approved' then
    v_rev := public.reverse_journal(k.journal_id, current_date, coalesce(nullif(trim(p_reason), ''), 'Commission cancelled'));
  end if;
  update public.commissions set status = 'cancelled', reversal_journal_id = v_rev, note = nullif(trim(p_reason), '') where id = k.id;
end $$;

-- change who gets the sale (and recalculate a still-pending commission)
create function public.set_salesperson(p_doc uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.sales_docs;
begin
  select * into d from public.sales_docs where id = p_doc for update;
  if d.id is null or not private.has_role(d.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Document not found, or only owners, admins and accountants can change the salesperson';
  end if;
  if p_user is not null and not exists (select 1 from public.company_members where company_id = d.company_id and user_id = p_user) then
    raise exception 'The salesperson must be on your team';
  end if;
  if exists (select 1 from public.commissions where invoice_id = d.id and status in ('approved', 'paid')) then
    raise exception 'Commission on this invoice is already approved; cancel it first';
  end if;
  perform set_config('kageflow.system', 'on', true);
  update public.sales_docs set salesperson_id = p_user where id = d.id;
  if d.doc_type = 'invoice' and d.status = 'issued' then
    update public.commissions set status = 'cancelled', note = 'Salesperson changed' where invoice_id = d.id and status = 'pending';
  end if;
  perform set_config('kageflow.system', 'off', true);
  if d.doc_type = 'invoice' and d.status = 'issued' and p_user is not null then
    perform private.commission_for_invoice(d.id);
  end if;
end $$;

alter table public.commission_plans enable row level security;
alter table public.commissions enable row level security;
create policy commission_plans_select on public.commission_plans for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]) or user_id = auth.uid());
create policy commission_plans_insert on public.commission_plans for insert to authenticated with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy commission_plans_update on public.commission_plans for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[])) with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy commission_plans_remove on public.commission_plans for delete to authenticated using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy commissions_select on public.commissions for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]) or user_id = auth.uid());
revoke all on public.commission_plans, public.commissions from anon;
revoke insert, update on public.commissions from authenticated;

-- ---------- finance house commission (DIC) ----------
alter table public.finance_submissions add column dic_amount numeric(18, 2) check (dic_amount >= 0);

-- ---------- profit per car ----------
create view public.vehicle_profit with (security_invoker = true) as
with costs as (
  select c.unit_id,
         sum(c.amount) filter (where c.reversal_journal_id is null) as landed,
         sum(c.amount) filter (where c.reversal_journal_id is null and c.kind = 'purchase') as purchase,
         sum(c.amount) filter (where c.reversal_journal_id is null and c.kind = 'repairs') as recon,
         sum(c.amount) filter (where c.reversal_journal_id is null and c.kind not in ('purchase', 'repairs')) as other_costs
    from public.unit_costs c
   group by c.unit_id
), inv as (
  select d.id, d.number, d.issue_date, d.salesperson_id, d.account_id, d.fx_rate,
         coalesce(sum(round(l.line_subtotal * d.fx_rate, 2)) filter (where l.unit_id is not null), 0) as units_net,
         count(l.unit_id) as units,
         coalesce(sum(round(l.line_subtotal * d.fx_rate, 2)) filter (where l.unit_id is null), 0)
           - coalesce(sum(l.cost_amount) filter (where l.unit_id is null), 0) as other_margin,
         (select coalesce(sum(k.amount), 0) from public.commissions k where k.invoice_id = d.id and k.status <> 'cancelled') as commission
    from public.sales_docs d
    join public.sales_doc_lines l on l.doc_id = d.id
   where d.doc_type = 'invoice' and d.status = 'issued'
   group by d.id
)
select u.id as unit_id, u.company_id, u.stock_no, u.serial_no, u.make, u.model, u.variant, u.year, u.status,
       u.list_price, u.advert_price, u.list_currency, u.image_url,
       coalesce(u.acquired_on, u.created_at::date) as acquired_on,
       u.sold_at,
       coalesce(u.sold_at::date, current_date) - coalesce(u.acquired_on, u.created_at::date) as days_in_stock,
       coalesce(c.landed, 0)::numeric(18, 2) as landed_cost,
       coalesce(c.purchase, 0)::numeric(18, 2) as purchase_cost,
       coalesce(c.recon, 0)::numeric(18, 2) as recon_cost,
       coalesce(c.other_costs, 0)::numeric(18, 2) as other_costs,
       i.id as invoice_id, i.number as invoice_number, i.issue_date as sold_on, i.salesperson_id, i.account_id,
       round(l.line_subtotal * i.fx_rate, 2) as sale_net,
       l.cost_amount as cogs,
       round(l.line_subtotal * i.fx_rate, 2) - coalesce(l.cost_amount, 0) as gross_profit,
       case when i.id is null then null
            when i.units_net > 0 then round(i.other_margin * round(l.line_subtotal * i.fx_rate, 2) / i.units_net, 2)
            else round(i.other_margin / greatest(i.units, 1), 2) end as addon_profit,
       case when i.id is null then null
            when i.units_net > 0 then round(i.commission * round(l.line_subtotal * i.fx_rate, 2) / i.units_net, 2)
            else round(i.commission / greatest(i.units, 1), 2) end as commission,
       (select coalesce(sum(fs.dic_amount), 0) from public.finance_submissions fs join public.finance_applications fa on fa.id = fs.application_id
         where fa.unit_id = u.id and fs.status = 'paid_out') as finance_income
  from public.inventory_units u
  left join costs c on c.unit_id = u.id
  left join public.sales_doc_lines l on l.unit_id = u.id and l.doc_id = u.sold_doc_id
  left join inv i on i.id = l.doc_id;

revoke all on public.vehicle_profit from anon;
grant select on public.vehicle_profit to authenticated;

revoke all on function public.approve_commissions(uuid[], date) from public, anon;
revoke all on function public.pay_commissions(uuid[], uuid, date, text) from public, anon;
revoke all on function public.cancel_commission(uuid, text) from public, anon;
revoke all on function public.set_salesperson(uuid, uuid) from public, anon;
revoke all on function private.commission_for_invoice(uuid) from public;
grant execute on function public.approve_commissions(uuid[], date) to authenticated;
grant execute on function public.pay_commissions(uuid[], uuid, date, text) to authenticated;
grant execute on function public.cancel_commission(uuid, text) to authenticated;
grant execute on function public.set_salesperson(uuid, uuid) to authenticated;

create trigger audit_commission_plans after insert or update or delete on public.commission_plans for each row execute function private.audit_row();
create trigger audit_commissions after insert or update or delete on public.commissions for each row execute function private.audit_row();
