-- Kageflow 0003: ledger — chart of accounts, periods, journals, posting engine
-- Rules enforced by the database:
--   * a journal is posted only if debits = credits, it has >= 2 lines and its period is open
--   * posted journals and their lines can never be edited or deleted; corrections are reversals
--   * every line's account belongs to the same company as its journal (composite FKs)

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.journal_status as enum ('draft', 'posted');
create type public.period_status as enum ('open', 'closed', 'locked');

-- ---------- chart of accounts ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Za-z.\-]{1,20}$'),
  name text not null check (length(trim(name)) > 0),
  type public.account_type not null,
  system_key text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, code),
  unique (company_id, system_key)
);
create trigger accounts_touch before update on public.accounts
  for each row execute function private.touch_updated_at();

-- System accounts keep their type and key
create function private.guard_system_account()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System account % cannot be removed', old.code;
    end if;
    return old;
  end if;
  if old.is_system and (new.type <> old.type or new.system_key is distinct from old.system_key or not new.is_system) then
    raise exception 'System account % keeps its type and key', old.code;
  end if;
  return new;
end $$;
create trigger accounts_guard before update or delete on public.accounts
  for each row execute function private.guard_system_account();

-- ---------- fiscal periods ----------
create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  status public.period_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  constraint fiscal_periods_no_overlap exclude using gist (
    company_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create trigger fiscal_periods_touch before update on public.fiscal_periods
  for each row execute function private.touch_updated_at();

create function private.guard_period()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'locked' and new.status <> 'locked'
     and not private.has_role(old.company_id, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can unlock a locked period';
  end if;
  if old.status <> 'open' and (new.start_date <> old.start_date or new.end_date <> old.end_date) then
    raise exception 'Reopen the period before changing its dates';
  end if;
  return new;
end $$;
create trigger fiscal_periods_guard before update on public.fiscal_periods
  for each row execute function private.guard_period();

-- ---------- document numbering ----------
create table public.document_sequences (
  company_id uuid not null references public.companies (id) on delete cascade,
  doc_type text not null,
  prefix text not null,
  next_no bigint not null default 1,
  primary key (company_id, doc_type)
);

create function private.next_doc_number(p_company uuid, p_type text, p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_no bigint;
  v_prefix text;
begin
  insert into public.document_sequences (company_id, doc_type, prefix)
  values (p_company, p_type, p_prefix)
  on conflict (company_id, doc_type) do nothing;
  update public.document_sequences
     set next_no = next_no + 1
   where company_id = p_company and doc_type = p_type
  returning next_no - 1, prefix into v_no, v_prefix;
  return v_prefix || '-' || lpad(v_no::text, 6, '0');
end $$;

-- ---------- journals ----------
create table public.journals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  journal_date date not null default current_date,
  description text not null check (length(trim(description)) > 0),
  source_type text not null default 'manual',
  source_id uuid,
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  status public.journal_status not null default 'draft',
  posted_at timestamptz,
  posted_by uuid,
  reversal_of uuid,
  reversed_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, reversal_of) references public.journals (company_id, id),
  foreign key (company_id, reversed_by) references public.journals (company_id, id)
);
create index journals_company_date_idx on public.journals (company_id, journal_date desc);
create index journals_source_idx on public.journals (company_id, source_type, source_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  journal_id uuid not null,
  line_no int not null check (line_no > 0),
  account_id uuid not null,
  description text,
  debit numeric(18, 2) not null default 0 check (debit >= 0),
  credit numeric(18, 2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0)),
  unique (journal_id, line_no),
  foreign key (company_id, journal_id) references public.journals (company_id, id) on delete cascade,
  foreign key (company_id, account_id) references public.accounts (company_id, id)
);
create index journal_lines_account_idx on public.journal_lines (company_id, account_id);
create index journal_lines_journal_idx on public.journal_lines (journal_id);

-- Journal guard: validates posting, freezes posted rows
create function private.guard_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_lines int;
  v_period public.period_status;
  v_inactive text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Journals start as drafts; post them with post_journal';
    end if;
    if new.reversal_of is not null or new.reversed_by is not null then
      if coalesce(current_setting('kageflow.reversing', true), '') <> 'on' then
        raise exception 'Use reverse_journal to create reversals';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Posted journal % is locked; reverse it instead', old.number;
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'posted' then
    if coalesce(current_setting('kageflow.reversing', true), '') = 'on'
       and old.reversed_by is null and new.reversed_by is not null
       and (to_jsonb(new) - 'reversed_by' - 'updated_at') = (to_jsonb(old) - 'reversed_by' - 'updated_at') then
      new.updated_at := now();
      return new;
    end if;
    raise exception 'Posted journal % is locked; reverse it instead', old.number;
  end if;

  if new.reversal_of is distinct from old.reversal_of or new.reversed_by is distinct from old.reversed_by then
    raise exception 'Reversal links are set by reverse_journal only';
  end if;

  if new.status = 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
      into v_debit, v_credit, v_lines
      from public.journal_lines where journal_id = new.id;
    if v_lines < 2 then
      raise exception 'A journal needs at least two lines';
    end if;
    if v_debit <> v_credit then
      raise exception 'Journal does not balance: debits % vs credits %', v_debit, v_credit;
    end if;
    if v_debit = 0 then
      raise exception 'Journal total cannot be zero';
    end if;
    select p.status into v_period
      from public.fiscal_periods p
     where p.company_id = new.company_id and new.journal_date between p.start_date and p.end_date;
    if v_period is not null and v_period <> 'open' then
      raise exception 'The period for % is %', new.journal_date, v_period;
    end if;
    select string_agg(a.code, ', ') into v_inactive
      from public.journal_lines l join public.accounts a on a.id = l.account_id
     where l.journal_id = new.id and not a.is_active;
    if v_inactive is not null then
      raise exception 'Inactive accounts on this journal: %', v_inactive;
    end if;
    if new.number is null then
      new.number := private.next_doc_number(new.company_id, 'journal', 'JNL');
    end if;
    new.posted_at := now();
    new.posted_by := auth.uid();
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger journals_guard before insert or update or delete on public.journals
  for each row execute function private.guard_journal();

create function private.guard_journal_line()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if exists (select 1 from public.journals j where j.id = old.journal_id and j.status = 'posted') then
      raise exception 'Lines of a posted journal cannot be changed';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if exists (select 1 from public.journals j where j.id = new.journal_id and j.status = 'posted') then
      raise exception 'Lines of a posted journal cannot be changed';
    end if;
    return new;
  end if;
  return old;
end $$;

create trigger journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function private.guard_journal_line();

-- ---------- posting rules ----------
create table public.posting_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source_type text not null,
  line_key text not null,
  account_id uuid not null,
  description text,
  unique (company_id, source_type, line_key),
  foreign key (company_id, account_id) references public.accounts (company_id, id)
);

-- ---------- RPCs ----------
create function public.post_journal(p_journal uuid)
returns public.journals language plpgsql security invoker set search_path = '' as $$
declare
  v public.journals;
begin
  update public.journals set status = 'posted' where id = p_journal and status = 'draft'
  returning * into v;
  if v.id is null then
    raise exception 'Draft journal not found or you lack permission';
  end if;
  return v;
end $$;

create function public.reverse_journal(p_journal uuid, p_date date default current_date, p_reason text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  o public.journals;
  v_new uuid;
begin
  select * into o from public.journals where id = p_journal for update;
  if o.id is null then
    raise exception 'Journal not found';
  end if;
  if o.status <> 'posted' then
    raise exception 'Only posted journals can be reversed; discard the draft instead';
  end if;
  if o.reversed_by is not null or o.reversal_of is not null then
    raise exception 'Journal % is already part of a reversal', o.number;
  end if;

  perform set_config('kageflow.reversing', 'on', true);

  insert into public.journals (company_id, journal_date, description, source_type, source_id, currency, fx_rate, reversal_of)
  values (o.company_id, p_date,
          'Reversal of ' || o.number || coalesce(': ' || nullif(trim(p_reason), ''), ''),
          o.source_type, o.source_id, o.currency, o.fx_rate, o.id)
  returning id into v_new;

  insert into public.journal_lines (company_id, journal_id, line_no, account_id, description, debit, credit)
  select company_id, v_new, line_no, account_id, description, credit, debit
    from public.journal_lines where journal_id = o.id;

  update public.journals set status = 'posted' where id = v_new;
  update public.journals set reversed_by = v_new where id = o.id;

  perform set_config('kageflow.reversing', 'off', true);
  return v_new;
end $$;

-- Posting engine: modules call this with rule keys; it resolves accounts, writes and posts the journal.
-- p_lines: [{"key": "receivable", "debit": 115}, {"account_id": "...", "credit": 100, "description": "..."}]
create function public.post_document(
  p_company uuid,
  p_source_type text,
  p_source_id uuid,
  p_date date,
  p_description text,
  p_lines jsonb,
  p_currency char(3) default 'ZAR',
  p_fx_rate numeric default 1
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_journal uuid;
  v_line jsonb;
  v_account uuid;
  v_no int := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'post_document needs at least two lines';
  end if;

  insert into public.journals (company_id, journal_date, description, source_type, source_id, currency, fx_rate)
  values (p_company, p_date, p_description, p_source_type, p_source_id, p_currency, p_fx_rate)
  returning id into v_journal;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    if v_line ? 'account_id' then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      select r.account_id into v_account
        from public.posting_rules r
       where r.company_id = p_company and r.source_type = p_source_type and r.line_key = v_line ->> 'key';
      if v_account is null then
        raise exception 'No posting rule for %.%', p_source_type, v_line ->> 'key';
      end if;
    end if;
    insert into public.journal_lines (company_id, journal_id, line_no, account_id, description, debit, credit)
    values (p_company, v_journal, v_no, v_account, v_line ->> 'description',
            round(coalesce((v_line ->> 'debit')::numeric, 0), 2),
            round(coalesce((v_line ->> 'credit')::numeric, 0), 2));
  end loop;

  update public.journals set status = 'posted' where id = v_journal;
  return v_journal;
end $$;

create function public.trial_balance(p_company uuid, p_as_of date default current_date)
returns table (
  account_id uuid, code text, name text, type public.account_type,
  debit numeric, credit numeric, balance numeric
) language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name, a.type,
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0),
         coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
    from public.accounts a
    left join (
      public.journal_lines l
      join public.journals j on j.id = l.journal_id and j.status = 'posted' and j.journal_date <= p_as_of
    ) on l.account_id = a.id
   where a.company_id = p_company
   group by a.id, a.code, a.name, a.type
   order by a.code;
$$;

revoke all on function public.post_journal(uuid) from public, anon;
revoke all on function public.reverse_journal(uuid, date, text) from public, anon;
revoke all on function public.post_document(uuid, text, uuid, date, text, jsonb, char, numeric) from public, anon;
revoke all on function public.trial_balance(uuid, date) from public, anon;
grant execute on function public.post_journal(uuid) to authenticated;
grant execute on function public.reverse_journal(uuid, date, text) to authenticated;
grant execute on function public.post_document(uuid, text, uuid, date, text, jsonb, char, numeric) to authenticated;
grant execute on function public.trial_balance(uuid, date) to authenticated;

-- ---------- RLS ----------
alter table public.accounts enable row level security;
alter table public.fiscal_periods enable row level security;
alter table public.document_sequences enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
alter table public.posting_rules enable row level security;

-- read: any member; write: owner, admin, accountant
create policy accounts_select on public.accounts for select to authenticated using (private.is_member(company_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy accounts_update on public.accounts for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy accounts_delete on public.accounts for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

create policy periods_select on public.fiscal_periods for select to authenticated using (private.is_member(company_id));
create policy periods_insert on public.fiscal_periods for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy periods_update on public.fiscal_periods for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy periods_delete on public.fiscal_periods for delete to authenticated
  using (status = 'open' and private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy sequences_select on public.document_sequences for select to authenticated using (private.is_member(company_id));

create policy journals_select on public.journals for select to authenticated using (private.is_member(company_id));
create policy journals_insert on public.journals for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy journals_update on public.journals for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy journals_delete on public.journals for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

create policy lines_select on public.journal_lines for select to authenticated using (private.is_member(company_id));
create policy lines_insert on public.journal_lines for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy lines_update on public.journal_lines for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy lines_delete on public.journal_lines for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

create policy rules_select on public.posting_rules for select to authenticated using (private.is_member(company_id));
create policy rules_insert on public.posting_rules for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy rules_update on public.posting_rules for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy rules_delete on public.posting_rules for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

revoke all on public.accounts, public.fiscal_periods, public.document_sequences,
  public.journals, public.journal_lines, public.posting_rules from anon;
revoke insert, update on public.document_sequences from authenticated;

-- ---------- audit ----------
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function private.audit_row();
create trigger audit_fiscal_periods after insert or update or delete on public.fiscal_periods
  for each row execute function private.audit_row();
create trigger audit_journals after insert or update or delete on public.journals
  for each row execute function private.audit_row();
create trigger audit_journal_lines after insert or update or delete on public.journal_lines
  for each row execute function private.audit_row();
create trigger audit_posting_rules after insert or update or delete on public.posting_rules
  for each row execute function private.audit_row();

-- ---------- seed: South African chart of accounts + default posting rules ----------
create function private.seed_ledger(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (company_id, code, name, type, system_key, is_system) values
    (p_company, '1000', 'Bank - current account', 'asset', 'bank', true),
    (p_company, '1050', 'Petty cash', 'asset', null, false),
    (p_company, '1100', 'Accounts receivable', 'asset', 'receivables', true),
    (p_company, '1200', 'Inventory', 'asset', 'inventory', true),
    (p_company, '1250', 'Landed cost clearing', 'asset', 'landed_cost_clearing', true),
    (p_company, '1300', 'Prepayments and deposits paid', 'asset', null, false),
    (p_company, '1400', 'VAT input', 'asset', 'vat_input', true),
    (p_company, '1500', 'Property, plant and equipment', 'asset', null, false),
    (p_company, '1510', 'Accumulated depreciation', 'asset', null, false),
    (p_company, '1600', 'Motor vehicles (fixed assets)', 'asset', null, false),
    (p_company, '2000', 'Accounts payable', 'liability', 'payables', true),
    (p_company, '2100', 'VAT output', 'liability', 'vat_output', true),
    (p_company, '2150', 'VAT control', 'liability', 'vat_control', true),
    (p_company, '2200', 'Customer deposits received', 'liability', 'customer_deposits', true),
    (p_company, '2300', 'Accrued expenses', 'liability', null, false),
    (p_company, '2400', 'PAYE, UIF and SDL payable', 'liability', null, false),
    (p_company, '2500', 'Loans payable', 'liability', null, false),
    (p_company, '3000', 'Share capital', 'equity', 'share_capital', true),
    (p_company, '3100', 'Retained earnings', 'equity', 'retained_earnings', true),
    (p_company, '4000', 'Sales - local', 'income', 'sales', true),
    (p_company, '4100', 'Sales - export (zero-rated)', 'income', 'sales_export', true),
    (p_company, '4200', 'Service income', 'income', null, false),
    (p_company, '4900', 'Other income', 'income', null, false),
    (p_company, '4950', 'Foreign exchange gains', 'income', 'fx_gain', true),
    (p_company, '5000', 'Cost of sales', 'expense', 'cogs', true),
    (p_company, '5100', 'Freight and clearing on sales', 'expense', null, false),
    (p_company, '6000', 'Salaries and wages', 'expense', null, false),
    (p_company, '6100', 'Rent', 'expense', null, false),
    (p_company, '6200', 'Water and electricity', 'expense', null, false),
    (p_company, '6300', 'Telephone and internet', 'expense', null, false),
    (p_company, '6400', 'Fuel and vehicle expenses', 'expense', null, false),
    (p_company, '6500', 'Advertising and marketing', 'expense', null, false),
    (p_company, '6600', 'Bank charges', 'expense', 'bank_charges', true),
    (p_company, '6700', 'Accounting and legal fees', 'expense', null, false),
    (p_company, '6800', 'Insurance', 'expense', null, false),
    (p_company, '6900', 'Depreciation', 'expense', null, false),
    (p_company, '6950', 'Foreign exchange losses', 'expense', 'fx_loss', true),
    (p_company, '7000', 'Interest paid', 'expense', null, false),
    (p_company, '9999', 'Suspense', 'asset', 'suspense', true);

  insert into public.posting_rules (company_id, source_type, line_key, account_id, description)
  select p_company, r.source_type, r.line_key, a.id, r.description
    from (values
      ('sales_invoice', 'receivable', 'receivables', 'Amount owed by the customer'),
      ('sales_invoice', 'revenue', 'sales', 'Local sales'),
      ('sales_invoice', 'revenue_export', 'sales_export', 'Zero-rated export sales'),
      ('sales_invoice', 'vat', 'vat_output', 'VAT charged'),
      ('sales_invoice', 'cogs', 'cogs', 'Cost of the goods sold'),
      ('sales_invoice', 'inventory', 'inventory', 'Stock relieved'),
      ('customer_payment', 'bank', 'bank', 'Money received'),
      ('customer_payment', 'receivable', 'receivables', 'Customer balance reduced'),
      ('customer_payment', 'deposit', 'customer_deposits', 'Deposit held'),
      ('customer_payment', 'fx_gain', 'fx_gain', 'Realised FX gain'),
      ('customer_payment', 'fx_loss', 'fx_loss', 'Realised FX loss'),
      ('supplier_bill', 'payable', 'payables', 'Amount owed to the supplier'),
      ('supplier_bill', 'vat', 'vat_input', 'VAT claimable'),
      ('supplier_bill', 'inventory', 'inventory', 'Stock purchased'),
      ('supplier_bill', 'landed_cost', 'landed_cost_clearing', 'Costs to allocate to stock'),
      ('supplier_payment', 'bank', 'bank', 'Money paid'),
      ('supplier_payment', 'payable', 'payables', 'Supplier balance reduced'),
      ('supplier_payment', 'bank_charges', 'bank_charges', 'Bank charges')
    ) as r (source_type, line_key, system_key, description)
    join public.accounts a on a.company_id = p_company and a.system_key = r.system_key;
end $$;

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
end $$;
