-- Kageflow 0007: quotes, orders, invoices, credit notes, customer payments, deposits and realised FX
--
-- Money model
--   * A document is priced in its own currency; fx_rate converts it to the company's base currency.
--   * Issuing an invoice posts Dr Receivables / Cr Sales (or Export sales when zero-rated) / Cr VAT output,
--     and for serial-tracked units Dr Cost of sales / Cr Inventory at the unit's landed cost.
--   * Every customer payment is first a deposit: Dr Bank / Cr Customer deposits at the payment's rate.
--   * Allocating a payment to an invoice posts Dr Customer deposits (payment rate) / Cr Receivables (invoice rate),
--     and the difference is the realised FX gain or loss.
--   * A credit note mirrors an invoice and reduces what is owed on it; a returned unit goes back to stock at its sold cost.

create type public.sales_doc_type as enum ('quote', 'order', 'invoice', 'credit_note');
create type public.sales_doc_status as enum ('draft', 'sent', 'accepted', 'declined', 'open', 'fulfilled', 'cancelled', 'issued');
create type public.payment_method as enum ('eft', 'cash', 'card', 'other');

create table public.sales_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  doc_type public.sales_doc_type not null,
  number text,
  status public.sales_doc_status not null default 'draft',
  account_id uuid not null,
  contact_id uuid,
  deal_id uuid,
  source_doc_id uuid,
  issue_date date not null default current_date,
  due_date date,
  valid_until date,
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  reference text,
  tracking_stage text,
  bill_to_name text,
  bill_to_address text,
  bill_to_vat_no text,
  notes text,
  terms text,
  credit_reason text,
  subtotal numeric(18, 2) not null default 0,
  tax_total numeric(18, 2) not null default 0,
  total numeric(18, 2) not null default 0,
  amount_paid numeric(18, 2) not null default 0,
  amount_credited numeric(18, 2) not null default 0,
  amount_due numeric(18, 2) generated always as (total - amount_paid - amount_credited) stored,
  journal_id uuid,
  issued_at timestamptz,
  issued_by uuid,
  share_token text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (doc_type = 'quote' and status in ('draft', 'sent', 'accepted', 'declined'))
    or (doc_type = 'order' and status in ('draft', 'open', 'fulfilled', 'cancelled'))
    or (doc_type in ('invoice', 'credit_note') and status in ('draft', 'issued'))
  ),
  check (amount_paid >= 0 and amount_credited >= 0),
  unique (company_id, number),
  unique (company_id, id),
  unique (share_token),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, contact_id) references public.crm_contacts (company_id, id) on delete set null (contact_id),
  foreign key (company_id, deal_id) references public.crm_deals (company_id, id) on delete set null (deal_id),
  foreign key (company_id, source_doc_id) references public.sales_docs (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id)
);
create index sales_docs_type_idx on public.sales_docs (company_id, doc_type, issue_date desc);
create index sales_docs_account_idx on public.sales_docs (company_id, account_id);
create index sales_docs_source_idx on public.sales_docs (company_id, source_doc_id);
create index sales_docs_open_idx on public.sales_docs (company_id, due_date) where doc_type = 'invoice' and status = 'issued';
create trigger sales_docs_touch before update on public.sales_docs for each row execute function private.touch_updated_at();

alter table public.inventory_units
  add foreign key (company_id, sold_doc_id) references public.sales_docs (company_id, id) on delete set null (sold_doc_id);

create table public.sales_doc_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  doc_id uuid not null,
  line_no int not null check (line_no > 0),
  product_id uuid,
  unit_id uuid,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(18, 4) not null default 1 check (quantity > 0),
  unit_price numeric(18, 2) not null default 0 check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate_id uuid not null,
  tax_rate numeric(6, 4) not null default 0,
  line_subtotal numeric(18, 2) not null default 0,
  line_tax numeric(18, 2) not null default 0,
  line_total numeric(18, 2) not null default 0,
  cost_amount numeric(18, 2),
  check (unit_id is null or quantity = 1),
  unique (doc_id, line_no),
  foreign key (company_id, doc_id) references public.sales_docs (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id),
  foreign key (company_id, tax_rate_id) references public.tax_rates (company_id, id)
);
create index sales_doc_lines_doc_idx on public.sales_doc_lines (doc_id);
create index sales_doc_lines_unit_idx on public.sales_doc_lines (company_id, unit_id) where unit_id is not null;

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  account_id uuid not null,
  order_id uuid,
  payment_date date not null default current_date,
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount numeric(18, 2) not null check (amount > 0),
  amount_allocated numeric(18, 2) not null default 0,
  bank_account_id uuid not null,
  method public.payment_method not null default 'eft',
  reference text,
  notes text,
  journal_id uuid,
  reversal_journal_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (amount_allocated between 0 and amount),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, order_id) references public.sales_docs (company_id, id),
  foreign key (company_id, bank_account_id) references public.accounts (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index customer_payments_account_idx on public.customer_payments (company_id, account_id, payment_date desc);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount numeric(18, 2) not null check (amount > 0),
  fx_difference numeric(18, 2) not null default 0,
  journal_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (company_id, payment_id) references public.customer_payments (company_id, id),
  foreign key (company_id, invoice_id) references public.sales_docs (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id)
);
create index payment_allocations_invoice_idx on public.payment_allocations (company_id, invoice_id);
create index payment_allocations_payment_idx on public.payment_allocations (company_id, payment_id);

-- ---------- helpers ----------
create function private.is_system()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('kageflow.system', true), '') = 'on';
$$;

create function private.rule_account(p_company uuid, p_source text, p_key text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid;
begin
  select account_id into v from public.posting_rules where company_id = p_company and source_type = p_source and line_key = p_key;
  if v is null then
    raise exception 'No posting rule for %.% - check Settings', p_source, p_key;
  end if;
  return v;
end $$;

-- Webhook hook: replaced by migration 0008
create function private.emit_event(p_company uuid, p_event text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

-- ---------- line maths ----------
create function private.sales_line_compute()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.sales_doc_status;
  v_doc_company uuid;
  v_rate numeric;
  v_tracking public.product_tracking;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_status from public.sales_docs where id = old.doc_id;
    if v_status is not null and v_status <> 'draft' and not private.is_system() then
      raise exception 'Only draft documents can be edited';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  select status, company_id into v_status, v_doc_company from public.sales_docs where id = new.doc_id;
  if v_status <> 'draft' and not private.is_system() then
    raise exception 'Only draft documents can be edited';
  end if;
  select rate into v_rate from public.tax_rates where id = new.tax_rate_id and company_id = new.company_id;
  if v_rate is null then
    raise exception 'Unknown tax rate';
  end if;
  if new.unit_id is not null then
    new.quantity := 1;
  elsif new.product_id is not null then
    select tracking into v_tracking from public.products where id = new.product_id;
    if v_tracking = 'serial' then
      raise exception 'Pick the specific unit (VIN) for %', new.description;
    end if;
  end if;
  new.tax_rate := v_rate;
  new.line_subtotal := round(new.quantity * new.unit_price * (1 - new.discount_pct / 100), 2);
  new.line_tax := round(new.line_subtotal * v_rate, 2);
  new.line_total := new.line_subtotal + new.line_tax;
  return new;
end $$;
create trigger sales_doc_lines_compute before insert or update or delete on public.sales_doc_lines
  for each row execute function private.sales_line_compute();

create function private.sales_doc_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_doc uuid := coalesce(new.doc_id, old.doc_id);
begin
  perform set_config('kageflow.totals', 'on', true);
  update public.sales_docs d
     set subtotal = coalesce(t.s, 0), tax_total = coalesce(t.x, 0), total = coalesce(t.s, 0) + coalesce(t.x, 0)
    from (select sum(line_subtotal) s, sum(line_tax) x from public.sales_doc_lines where doc_id = v_doc) t
   where d.id = v_doc;
  perform set_config('kageflow.totals', 'off', true);
  return null;
end $$;
create trigger sales_doc_lines_totals after insert or update or delete on public.sales_doc_lines
  for each row execute function private.sales_doc_totals();

-- ---------- document guard ----------
create function private.guard_sales_doc()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not private.is_system() then
      raise exception 'Documents start as drafts';
    end if;
    if new.number is not null and not private.is_system() then
      raise exception 'Numbers are assigned automatically';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception '% % is %; it can no longer be removed', initcap(replace(old.doc_type::text, '_', ' ')), coalesce(old.number, ''), old.status;
    end if;
    return old;
  end if;

  if private.is_system() or coalesce(current_setting('kageflow.totals', true), '') = 'on' then
    return new;
  end if;

  if old.status = 'issued' then
    raise exception '% is issued and locked; use a credit note to correct it', coalesce(old.number, 'This document');
  end if;

  if new.number is distinct from old.number or new.journal_id is distinct from old.journal_id
     or new.amount_paid <> old.amount_paid or new.amount_credited <> old.amount_credited
     or new.subtotal <> old.subtotal or new.total <> old.total or new.tax_total <> old.tax_total
     or new.doc_type <> old.doc_type or new.share_token <> old.share_token then
    raise exception 'That field is managed by Kageflow';
  end if;

  if new.status <> old.status then
    v_ok := case old.doc_type
      when 'quote' then (old.status, new.status) in (('draft', 'sent'), ('draft', 'accepted'), ('draft', 'declined'), ('sent', 'accepted'), ('sent', 'declined'), ('sent', 'draft'))
      when 'order' then (old.status, new.status) in (('draft', 'open'), ('open', 'fulfilled'), ('open', 'cancelled'), ('draft', 'cancelled'))
      else false
    end;
    if not v_ok then
      raise exception 'A % cannot go from % to %', replace(old.doc_type::text, '_', ' '), old.status, new.status;
    end if;
  end if;

  -- after a quote is sent or an order confirmed, the commercial terms are fixed
  if old.status <> 'draft' and (new.account_id <> old.account_id or new.currency <> old.currency or new.fx_rate <> old.fx_rate) then
    raise exception 'Customer, currency and rate are fixed once a document leaves draft';
  end if;
  return new;
end $$;
create trigger sales_docs_guard before insert or update or delete on public.sales_docs
  for each row execute function private.guard_sales_doc();

-- Orders reserve their units; cancelling releases them. Order changes notify webhooks.
create function private.sales_doc_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := coalesce(current_setting('kageflow.system', true), '');
begin
  if new.doc_type = 'order' and new.status is distinct from old.status then
    perform set_config('kageflow.system', 'on', true);
    if new.status = 'open' then
      update public.inventory_units u set status = 'reserved'
        from public.sales_doc_lines l
       where l.doc_id = new.id and l.unit_id = u.id and u.status in ('in_stock', 'in_transit', 'on_order');
    elsif new.status = 'cancelled' then
      update public.inventory_units u set status = 'in_stock'
        from public.sales_doc_lines l
       where l.doc_id = new.id and l.unit_id = u.id and u.status = 'reserved';
    end if;
    perform set_config('kageflow.system', v_prev, true);
  end if;
  if new.doc_type = 'order' and (new.status is distinct from old.status or new.tracking_stage is distinct from old.tracking_stage) then
    perform private.emit_event(new.company_id, 'order.updated', jsonb_build_object(
      'id', new.id, 'number', new.number, 'reference', new.reference, 'status', new.status,
      'tracking_stage', new.tracking_stage, 'account_id', new.account_id, 'currency', new.currency, 'total', new.total));
  end if;
  return null;
end $$;
create trigger sales_docs_after after update on public.sales_docs
  for each row execute function private.sales_doc_after();

-- Orders get their number when confirmed, quotes when sent
create function private.sales_doc_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null and new.status <> 'draft' and new.doc_type in ('quote', 'order') then
    new.number := private.next_doc_number(new.company_id, new.doc_type::text, case new.doc_type when 'quote' then 'QUO' else 'SO' end);
  end if;
  return new;
end $$;
create trigger sales_docs_number before update on public.sales_docs
  for each row execute function private.sales_doc_number();

-- ---------- conversion: quote -> order/invoice, order -> invoice, invoice -> credit note ----------
create function public.convert_sales_doc(p_doc uuid, p_to public.sales_doc_type)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.sales_docs;
  v_new uuid;
begin
  select * into s from public.sales_docs where id = p_doc;
  if s.id is null or not private.has_role(s.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Document not found or your role can''t create sales documents';
  end if;
  if not (
    (s.doc_type = 'quote' and p_to in ('order', 'invoice') and s.status <> 'declined')
    or (s.doc_type = 'order' and p_to = 'invoice' and s.status = 'open')
    or (s.doc_type = 'invoice' and p_to = 'credit_note' and s.status = 'issued')
  ) then
    raise exception 'A % (%) can''t become a %', replace(s.doc_type::text, '_', ' '), s.status, replace(p_to::text, '_', ' ');
  end if;
  if p_to = 'credit_note' and s.amount_due <= 0 then
    raise exception 'Invoice % has nothing left to credit', s.number;
  end if;

  insert into public.sales_docs (company_id, doc_type, account_id, contact_id, deal_id, source_doc_id, currency, fx_rate, reference, notes, terms)
  values (s.company_id, p_to, s.account_id, s.contact_id, s.deal_id, s.id, s.currency, s.fx_rate, s.reference, s.notes, s.terms)
  returning id into v_new;

  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, quantity, unit_price, discount_pct, tax_rate_id)
  select company_id, v_new, line_no, product_id, unit_id, description, quantity, unit_price, discount_pct, tax_rate_id
    from public.sales_doc_lines where doc_id = s.id order by line_no;

  if s.doc_type = 'quote' and s.status <> 'accepted' then
    update public.sales_docs set status = 'accepted' where id = s.id;
  end if;
  return v_new;
end $$;

-- ---------- allocation (internal) ----------
create function private.allocate_payment(p_payment uuid, p_invoice uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  i public.sales_docs;
  v_amount numeric := round(p_amount, 2);
  v_dep numeric;
  v_rec numeric;
  v_diff numeric;
  v_lines jsonb;
  v_alloc uuid;
  v_journal uuid;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  select * into i from public.sales_docs where id = p_invoice for update;
  if p.id is null or i.id is null or p.company_id <> i.company_id then
    raise exception 'Payment or invoice not found';
  end if;
  if i.doc_type <> 'invoice' or i.status <> 'issued' then
    raise exception 'Payments can only be allocated to issued invoices';
  end if;
  if p.reversal_journal_id is not null then
    raise exception 'Payment % was reversed', p.number;
  end if;
  if p.account_id <> i.account_id then
    raise exception 'Payment % is from a different customer than invoice %', p.number, i.number;
  end if;
  if p.currency <> i.currency then
    raise exception 'Payment is in % but invoice % is in %', p.currency, i.number, i.currency;
  end if;
  if v_amount <= 0 then
    raise exception 'Allocation must be more than zero';
  end if;
  if v_amount > p.amount - p.amount_allocated then
    raise exception 'Only % % of payment % is unallocated', p.currency, p.amount - p.amount_allocated, p.number;
  end if;
  if v_amount > i.amount_due then
    raise exception 'Invoice % only has % % outstanding', i.number, i.currency, i.amount_due;
  end if;

  v_dep := round(v_amount * p.fx_rate, 2);
  v_rec := round(v_amount * i.fx_rate, 2);
  v_diff := v_dep - v_rec;

  insert into public.payment_allocations (company_id, payment_id, invoice_id, amount, fx_difference)
  values (p.company_id, p.id, i.id, v_amount, v_diff)
  returning id into v_alloc;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', private.rule_account(p.company_id, 'customer_payment', 'deposit'), 'debit', v_dep, 'description', 'Applied to ' || i.number),
    jsonb_build_object('account_id', private.rule_account(p.company_id, 'customer_payment', 'receivable'), 'credit', v_rec, 'description', i.number));
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(p.company_id, 'customer_payment', 'fx_gain'), 'credit', v_diff, 'description', 'Realised FX gain on ' || i.number);
  elsif v_diff < 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(p.company_id, 'customer_payment', 'fx_loss'), 'debit', -v_diff, 'description', 'Realised FX loss on ' || i.number);
  end if;

  v_journal := public.post_document(p.company_id, 'payment_allocation', v_alloc, greatest(p.payment_date, i.issue_date),
    'Payment ' || p.number || ' applied to ' || i.number, v_lines, p.currency, p.fx_rate);

  perform set_config('kageflow.system', 'on', true);
  update public.payment_allocations set journal_id = v_journal where id = v_alloc;
  update public.customer_payments set amount_allocated = amount_allocated + v_amount where id = p.id;
  update public.sales_docs set amount_paid = amount_paid + v_amount where id = i.id;
  perform set_config('kageflow.system', 'off', true);
  return v_alloc;
end $$;

-- ---------- issue an invoice or credit note ----------
create function public.issue_sales_doc(p_doc uuid)
returns public.sales_docs language plpgsql security definer set search_path = '' as $$
declare
  d public.sales_docs;
  src public.sales_docs;
  co public.companies;
  a public.crm_accounts;
  l record;
  v_lines jsonb := '[]'::jsonb;
  v_rev numeric := 0; v_rev_x numeric := 0; v_vat numeric := 0; v_cogs numeric := 0;
  v_sub numeric; v_tax numeric; v_cost numeric;
  v_receivable numeric;
  v_journal uuid;
  v_credit boolean;
  dep record;
  v_take numeric;
begin
  select * into d from public.sales_docs where id = p_doc for update;
  if d.id is null or not private.has_role(d.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Document not found or your role can''t issue documents';
  end if;
  if d.doc_type not in ('invoice', 'credit_note') or d.status <> 'draft' then
    raise exception 'Only draft invoices and credit notes can be issued';
  end if;
  v_credit := d.doc_type = 'credit_note';
  select * into co from public.companies where id = d.company_id;
  select * into a from public.crm_accounts where id = d.account_id;

  if not exists (select 1 from public.sales_doc_lines where doc_id = d.id) or d.total <= 0 then
    raise exception 'Add at least one line with a value before issuing';
  end if;
  if d.currency = co.base_currency and d.fx_rate <> 1 then
    raise exception 'Documents in % use a rate of 1', co.base_currency;
  end if;
  if co.vat_no is not null and round(d.total * d.fx_rate, 2) > 5000
     and (nullif(trim(coalesce(a.billing_address, '')), '') is null) then
    raise exception 'Over R5,000 SARS requires a full tax invoice: add a billing address for %', a.name;
  end if;

  if v_credit then
    select * into src from public.sales_docs where id = d.source_doc_id for update;
    if src.id is null or src.doc_type <> 'invoice' or src.status <> 'issued' then
      raise exception 'A credit note must be raised against an issued invoice';
    end if;
    if src.account_id <> d.account_id or src.currency <> d.currency then
      raise exception 'A credit note must match its invoice''s customer and currency';
    end if;
    if nullif(trim(coalesce(d.credit_reason, '')), '') is null then
      raise exception 'Give the reason for the credit note';
    end if;
    if d.total > src.amount_due then
      raise exception 'Credit note total % exceeds what is still owed on % (%)', d.total, src.number, src.amount_due;
    end if;
    if d.fx_rate <> src.fx_rate then
      perform set_config('kageflow.system', 'on', true);
      update public.sales_docs set fx_rate = src.fx_rate where id = d.id;
      perform set_config('kageflow.system', 'off', true);
      d.fx_rate := src.fx_rate;
    end if;
  end if;

  for l in
    select sl.*, tr.is_zero_rated, u.status as unit_status, u.serial_no, u.sold_doc_id, coalesce(uv.landed_cost, 0) as landed_cost
      from public.sales_doc_lines sl
      join public.tax_rates tr on tr.id = sl.tax_rate_id
      left join public.inventory_units u on u.id = sl.unit_id
      left join public.unit_values uv on uv.unit_id = sl.unit_id
     where sl.doc_id = d.id
     order by sl.line_no
  loop
    v_sub := round(l.line_subtotal * d.fx_rate, 2);
    v_tax := round(l.line_tax * d.fx_rate, 2);
    if l.is_zero_rated then v_rev_x := v_rev_x + v_sub; else v_rev := v_rev + v_sub; end if;
    v_vat := v_vat + v_tax;
    if l.unit_id is not null then
      if not v_credit then
        if l.unit_status in ('sold', 'written_off') then
          raise exception 'Unit % is already %', l.serial_no, l.unit_status;
        end if;
        v_cost := l.landed_cost;
      else
        if l.sold_doc_id is distinct from src.id then
          raise exception 'Unit % was not sold on invoice %', l.serial_no, src.number;
        end if;
        select cost_amount into v_cost from public.sales_doc_lines where doc_id = src.id and unit_id = l.unit_id;
        v_cost := coalesce(v_cost, 0);
      end if;
      v_cogs := v_cogs + v_cost;
      perform set_config('kageflow.system', 'on', true);
      update public.sales_doc_lines set cost_amount = v_cost where id = l.id;
      perform set_config('kageflow.system', 'off', true);
    end if;
  end loop;

  v_receivable := v_rev + v_rev_x + v_vat;
  if not v_credit then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'receivable'), 'debit', v_receivable, 'description', a.name);
    if v_rev > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue'), 'credit', v_rev); end if;
    if v_rev_x > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue_export'), 'credit', v_rev_x); end if;
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'vat'), 'credit', v_vat); end if;
    if v_cogs > 0 then
      v_lines := v_lines
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'cogs'), 'debit', v_cogs, 'description', 'Cost of units sold')
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'inventory'), 'credit', v_cogs);
    end if;
  else
    if v_rev > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue'), 'debit', v_rev); end if;
    if v_rev_x > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue_export'), 'debit', v_rev_x); end if;
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'vat'), 'debit', v_vat); end if;
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'receivable'), 'credit', v_receivable, 'description', a.name);
    if v_cogs > 0 then
      v_lines := v_lines
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'inventory'), 'debit', v_cogs, 'description', 'Units returned to stock')
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'cogs'), 'credit', v_cogs);
    end if;
  end if;

  perform set_config('kageflow.system', 'on', true);
  d.number := private.next_doc_number(d.company_id, d.doc_type::text, case when v_credit then 'CN' else 'INV' end);
  v_journal := public.post_document(d.company_id, d.doc_type::text, d.id, d.issue_date,
    case when v_credit then 'Credit note ' else 'Invoice ' end || d.number || ' - ' || a.name, v_lines, d.currency, d.fx_rate);

  update public.sales_docs
     set status = 'issued', number = d.number, journal_id = v_journal, issued_at = now(), issued_by = auth.uid(),
         due_date = coalesce(due_date, issue_date + coalesce(a.payment_days, co.default_payment_days)),
         bill_to_name = a.name, bill_to_address = a.billing_address, bill_to_vat_no = a.vat_no
   where id = d.id
  returning * into d;

  if not v_credit then
    update public.inventory_units u set status = 'sold', sold_doc_id = d.id, sold_at = now()
      from public.sales_doc_lines sl where sl.doc_id = d.id and sl.unit_id = u.id;
    if d.source_doc_id is not null then
      update public.sales_docs set status = 'fulfilled' where id = d.source_doc_id and doc_type = 'order' and status = 'open';
    end if;
  else
    update public.inventory_units u set status = 'in_stock', sold_doc_id = null, sold_at = null
      from public.sales_doc_lines sl where sl.doc_id = d.id and sl.unit_id = u.id;
    update public.sales_docs set amount_credited = amount_credited + d.total where id = src.id;
  end if;
  perform set_config('kageflow.system', 'off', true);

  -- deposits taken against the order are applied automatically
  if not v_credit and d.source_doc_id is not null then
    for dep in
      select id, amount - amount_allocated as free from public.customer_payments
       where company_id = d.company_id and order_id = d.source_doc_id and account_id = d.account_id
         and currency = d.currency and reversal_journal_id is null and amount > amount_allocated
       order by payment_date
    loop
      select amount_due into v_take from public.sales_docs where id = d.id;
      exit when v_take <= 0;
      perform private.allocate_payment(dep.id, d.id, least(dep.free, v_take));
    end loop;
    select * into d from public.sales_docs where id = d.id;
  end if;

  perform private.emit_event(d.company_id, case when v_credit then 'credit_note.issued' else 'invoice.issued' end, jsonb_build_object(
    'id', d.id, 'number', d.number, 'reference', d.reference, 'account_id', d.account_id, 'currency', d.currency,
    'total', d.total, 'amount_due', d.amount_due, 'issue_date', d.issue_date, 'due_date', d.due_date,
    'order_id', d.source_doc_id));
  return d;
end $$;

-- ---------- customer payments ----------
create function public.record_customer_payment(
  p_account uuid,
  p_amount numeric,
  p_bank_account uuid,
  p_currency char(3) default 'ZAR',
  p_fx_rate numeric default 1,
  p_date date default current_date,
  p_method public.payment_method default 'eft',
  p_reference text default null,
  p_order uuid default null,
  p_allocations jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.crm_accounts;
  co public.companies;
  v_id uuid;
  v_number text;
  v_journal uuid;
  v_rate numeric := coalesce(p_fx_rate, 1);
  al jsonb;
begin
  select * into a from public.crm_accounts where id = p_account;
  if a.id is null or not private.has_role(a.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Customer not found, or only owners, admins and accountants can record payments';
  end if;
  select * into co from public.companies where id = a.company_id;
  if p_currency = co.base_currency then v_rate := 1; end if;
  if v_rate <= 0 then raise exception 'Exchange rate must be more than zero'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = a.company_id and type = 'asset') then
    raise exception 'Pick the bank account the money went into';
  end if;
  if p_order is not null and not exists (
    select 1 from public.sales_docs where id = p_order and company_id = a.company_id and doc_type = 'order' and account_id = a.id and currency = p_currency
  ) then
    raise exception 'The order must belong to this customer and be in %', p_currency;
  end if;

  v_number := private.next_doc_number(a.company_id, 'customer_payment', 'PAY');
  insert into public.customer_payments (company_id, number, account_id, order_id, payment_date, currency, fx_rate, amount, bank_account_id, method, reference)
  values (a.company_id, v_number, a.id, p_order, p_date, p_currency, v_rate, round(p_amount, 2), p_bank_account, p_method, p_reference)
  returning id into v_id;

  v_journal := public.post_document(a.company_id, 'customer_payment', v_id, p_date, 'Payment ' || v_number || ' from ' || a.name,
    jsonb_build_array(
      jsonb_build_object('account_id', p_bank_account, 'debit', round(p_amount * v_rate, 2), 'description', coalesce(p_reference, a.name)),
      jsonb_build_object('account_id', private.rule_account(a.company_id, 'customer_payment', 'deposit'), 'credit', round(p_amount * v_rate, 2), 'description', a.name)),
    p_currency, v_rate);
  update public.customer_payments set journal_id = v_journal where id = v_id;

  for al in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if coalesce((al ->> 'amount')::numeric, 0) > 0 then
      perform private.allocate_payment(v_id, (al ->> 'invoice_id')::uuid, (al ->> 'amount')::numeric);
    end if;
  end loop;

  perform private.emit_event(a.company_id, 'payment.received', jsonb_build_object(
    'id', v_id, 'number', v_number, 'account_id', a.id, 'order_id', p_order, 'currency', p_currency,
    'amount', round(p_amount, 2), 'payment_date', p_date, 'reference', p_reference));
  return v_id;
end $$;

create function public.allocate_payment(p_payment uuid, p_invoice uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.customer_payments where id = p_payment;
  if v_company is null or not private.has_role(v_company, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Payment not found, or only owners, admins and accountants can allocate payments';
  end if;
  return private.allocate_payment(p_payment, p_invoice, p_amount);
end $$;

create function public.reverse_customer_payment(p_payment uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v_rev uuid;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null or not private.has_role(p.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Payment not found, or only owners, admins and accountants can reverse payments';
  end if;
  if p.reversal_journal_id is not null then
    raise exception 'Payment % is already reversed', p.number;
  end if;
  if p.amount_allocated > 0 then
    raise exception 'Payment % is applied to invoices; credit those invoices first', p.number;
  end if;
  v_rev := public.reverse_journal(p.journal_id, current_date, coalesce(p_reason, 'Payment reversed'));
  perform set_config('kageflow.system', 'on', true);
  update public.customer_payments set reversal_journal_id = v_rev where id = p.id;
  perform set_config('kageflow.system', 'off', true);
  return v_rev;
end $$;

-- ---------- shareable document (customer link, no sign-in) ----------
create function public.shared_sales_doc(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'doc', to_jsonb(d) - 'share_token' - 'journal_id' - 'created_by' - 'issued_by',
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_no', l.line_no, 'description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price,
        'discount_pct', l.discount_pct, 'tax_rate', l.tax_rate, 'line_subtotal', l.line_subtotal, 'line_tax', l.line_tax,
        'line_total', l.line_total, 'serial_no', u.serial_no, 'is_second_hand', u.is_second_hand) order by l.line_no)
      from public.sales_doc_lines l left join public.inventory_units u on u.id = l.unit_id where l.doc_id = d.id), '[]'::jsonb),
    'company', jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'registration_no', c.registration_no, 'vat_no', c.vat_no,
      'address', c.address, 'phone', c.phone, 'email', c.email, 'bank_details', c.bank_details, 'invoice_footer', c.invoice_footer,
      'base_currency', c.base_currency),
    'customer', jsonb_build_object('name', a.name, 'billing_address', a.billing_address, 'vat_no', a.vat_no, 'email', a.email),
    'source_number', (select s.number from public.sales_docs s where s.id = d.source_doc_id))
  from public.sales_docs d
  join public.companies c on c.id = d.company_id
  join public.crm_accounts a on a.id = d.account_id
  where d.share_token = p_token and d.status <> 'draft' and length(p_token) >= 32;
$$;

revoke all on function public.convert_sales_doc(uuid, public.sales_doc_type) from public, anon;
revoke all on function public.issue_sales_doc(uuid) from public, anon;
revoke all on function public.record_customer_payment(uuid, numeric, uuid, char, numeric, date, public.payment_method, text, uuid, jsonb) from public, anon;
revoke all on function public.allocate_payment(uuid, uuid, numeric) from public, anon;
revoke all on function public.reverse_customer_payment(uuid, text) from public, anon;
revoke all on function public.shared_sales_doc(text) from public;
grant execute on function public.convert_sales_doc(uuid, public.sales_doc_type) to authenticated;
grant execute on function public.issue_sales_doc(uuid) to authenticated;
grant execute on function public.record_customer_payment(uuid, numeric, uuid, char, numeric, date, public.payment_method, text, uuid, jsonb) to authenticated;
grant execute on function public.allocate_payment(uuid, uuid, numeric) to authenticated;
grant execute on function public.reverse_customer_payment(uuid, text) to authenticated;
grant execute on function public.shared_sales_doc(text) to anon, authenticated;
revoke all on function private.allocate_payment(uuid, uuid, numeric) from public;
revoke all on function private.rule_account(uuid, text, text) from public;
revoke all on function private.emit_event(uuid, text, jsonb) from public;

-- ---------- RLS ----------
alter table public.sales_docs enable row level security;
alter table public.sales_doc_lines enable row level security;
alter table public.customer_payments enable row level security;
alter table public.payment_allocations enable row level security;

create policy sales_docs_select on public.sales_docs for select to authenticated using (private.is_member(company_id));
create policy sales_docs_insert on public.sales_docs for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy sales_docs_update on public.sales_docs for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy sales_docs_remove on public.sales_docs for delete to authenticated
  using (status = 'draft' and private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy sales_lines_select on public.sales_doc_lines for select to authenticated using (private.is_member(company_id));
create policy sales_lines_insert on public.sales_doc_lines for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy sales_lines_update on public.sales_doc_lines for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy sales_lines_remove on public.sales_doc_lines for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy payments_select on public.customer_payments for select to authenticated using (private.is_member(company_id));
create policy allocations_select on public.payment_allocations for select to authenticated using (private.is_member(company_id));

revoke all on public.sales_docs, public.sales_doc_lines, public.customer_payments, public.payment_allocations from anon;
revoke insert, update on public.customer_payments, public.payment_allocations from authenticated;

create trigger audit_sales_docs after insert or update or delete on public.sales_docs for each row execute function private.audit_row();
create trigger audit_sales_doc_lines after insert or update or delete on public.sales_doc_lines for each row execute function private.audit_row();
create trigger audit_customer_payments after insert or update or delete on public.customer_payments for each row execute function private.audit_row();
create trigger audit_payment_allocations after insert or update or delete on public.payment_allocations for each row execute function private.audit_row();
