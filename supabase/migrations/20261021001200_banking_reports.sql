-- Kageflow 0012: bank reconciliation, VAT201, profit and loss, balance sheet
-- * Bank statement lines are imported from CSV and matched one-to-one with posted ledger lines on that bank account
-- * Unmatched statement lines can be posted straight to an account (with VAT) and are matched automatically
-- * VAT201 is worked out on the invoice basis from issued sales documents and the VAT accounts in the ledger
-- * Filing a VAT return moves VAT output and input into VAT control (what is owed to or by SARS)

-- ---------- bank statement lines ----------
create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  bank_account_id uuid not null,
  txn_date date not null,
  description text not null,
  amount numeric(18, 2) not null check (amount <> 0),
  balance numeric(18, 2),
  fingerprint text not null,
  journal_line_id uuid references public.journal_lines (id),
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  matched_at timestamptz,
  matched_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((status = 'matched') = (journal_line_id is not null)),
  unique (company_id, fingerprint),
  unique (company_id, id),
  foreign key (company_id, bank_account_id) references public.accounts (company_id, id)
);
create index bank_statement_lines_account_idx on public.bank_statement_lines (company_id, bank_account_id, txn_date desc);
create unique index bank_statement_lines_journal_line_idx on public.bank_statement_lines (journal_line_id) where journal_line_id is not null;

create function private.require_bank(p_bank uuid)
returns public.accounts language plpgsql stable security definer set search_path = '' as $$
declare
  a public.accounts;
begin
  select * into a from public.accounts where id = p_bank;
  if a.id is null or not private.has_role(a.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bank account not found, or only owners, admins and accountants can reconcile';
  end if;
  if a.type not in ('asset', 'liability') then raise exception '% is not a bank or card account', a.name; end if;
  return a;
end $$;

-- p_rows: [{"date": "2026-10-01", "description": "...", "amount": -150.00, "balance": 1000.00}]
create function public.import_bank_statement(p_bank uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.accounts;
  r jsonb;
  v_date date; v_amt numeric; v_desc text; v_key text;
  v_seen jsonb := '{}'::jsonb;
  v_n int;
  v_added int := 0; v_skipped int := 0; v_bad int := 0;
begin
  a := private.require_bank(p_bank);
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Rows must be a list'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_date := (r ->> 'date')::date;
      v_amt := round(private.safe_numeric(r ->> 'amount'), 2);
    exception when others then
      v_date := null;
    end;
    v_desc := coalesce(nullif(trim(r ->> 'description'), ''), 'No description');
    if v_date is null or v_amt is null or v_amt = 0 then
      v_bad := v_bad + 1;
      continue;
    end if;
    v_key := p_bank::text || '|' || v_date::text || '|' || v_amt::text || '|' || lower(v_desc);
    v_n := coalesce((v_seen ->> v_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_key, v_n);
    insert into public.bank_statement_lines (company_id, bank_account_id, txn_date, description, amount, balance, fingerprint)
    values (a.company_id, a.id, v_date, left(v_desc, 300), v_amt, round(private.safe_numeric(r ->> 'balance'), 2), md5(v_key || '|' || v_n))
    on conflict (company_id, fingerprint) do nothing;
    if found then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'duplicates', v_skipped, 'unreadable', v_bad);
end $$;

-- ledger lines on a bank account that can still be matched
create function private.open_bank_ledger_lines(p_bank uuid)
returns table (journal_line_id uuid, journal_id uuid, journal_number text, journal_date date, description text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, j.id, j.number, j.journal_date, coalesce(l.description, j.description), l.debit - l.credit
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
   where l.account_id = p_bank and j.status = 'posted' and j.reversed_by is null and j.reversal_of is null
     and not exists (select 1 from public.bank_statement_lines s where s.journal_line_id = l.id);
$$;

create function public.match_bank_line(p_line uuid, p_journal_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
  v_amt numeric;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Statement line not found'; end if;
  perform private.require_bank(s.bank_account_id);
  if s.status <> 'unmatched' then raise exception 'This statement line is already %', s.status; end if;
  select amount into v_amt from private.open_bank_ledger_lines(s.bank_account_id) where journal_line_id = p_journal_line;
  if v_amt is null then raise exception 'That entry is not on this bank account, is reversed, or is already matched'; end if;
  if v_amt <> s.amount then raise exception 'Amounts differ: statement % vs Kageflow %', s.amount, v_amt; end if;
  update public.bank_statement_lines set status = 'matched', journal_line_id = p_journal_line, matched_at = now(), matched_by = auth.uid() where id = s.id;
end $$;

create function public.unmatch_bank_line(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Statement line not found'; end if;
  perform private.require_bank(s.bank_account_id);
  update public.bank_statement_lines set status = 'unmatched', journal_line_id = null, matched_at = null, matched_by = null where id = s.id;
end $$;

create function public.ignore_bank_line(p_line uuid, p_ignore boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Statement line not found'; end if;
  perform private.require_bank(s.bank_account_id);
  if s.status = 'matched' then raise exception 'Unmatch the line first'; end if;
  update public.bank_statement_lines set status = case when p_ignore then 'ignored' else 'unmatched' end where id = s.id;
end $$;

-- matches each unmatched line to the closest-dated ledger line with the same amount within 10 days
create function public.auto_match_bank(p_bank uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_jl uuid;
  v_n int := 0;
begin
  perform private.require_bank(p_bank);
  for s in select * from public.bank_statement_lines where bank_account_id = p_bank and status = 'unmatched' order by txn_date, id loop
    select o.journal_line_id into v_jl
      from private.open_bank_ledger_lines(p_bank) o
     where o.amount = s.amount and o.journal_date between s.txn_date - 10 and s.txn_date + 10
     order by abs(o.journal_date - s.txn_date), o.journal_date
     limit 1;
    if v_jl is not null then
      update public.bank_statement_lines set status = 'matched', journal_line_id = v_jl, matched_at = now(), matched_by = auth.uid() where id = s.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- posts an unmatched statement line straight to an account, with VAT worked out of the amount, and matches it
create function public.post_bank_line(p_line uuid, p_account uuid, p_tax_rate uuid default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
  a public.accounts;
  co public.companies;
  v_rate numeric := 0;
  v_gross numeric; v_net numeric; v_vat numeric;
  v_lines jsonb;
  v_journal uuid;
  v_bank_line uuid;
  v_desc text;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Statement line not found'; end if;
  perform private.require_bank(s.bank_account_id);
  if s.status <> 'unmatched' then raise exception 'This statement line is already %', s.status; end if;
  select * into a from public.accounts where id = p_account and company_id = s.company_id and is_active;
  if a.id is null then raise exception 'Pick the account to post to'; end if;
  if a.id = s.bank_account_id then raise exception 'Pick a different account from the bank itself'; end if;
  if a.system_key in ('receivables', 'payables', 'vat_input', 'vat_output', 'inventory', 'customer_deposits') then
    raise exception '% is managed by Kageflow: record a customer payment, supplier payment or bill instead, then match it', a.name;
  end if;
  select * into co from public.companies where id = s.company_id;
  if p_tax_rate is not null and nullif(trim(coalesce(co.vat_no, '')), '') is not null then
    select rate into v_rate from public.tax_rates where id = p_tax_rate and company_id = s.company_id;
  end if;
  v_gross := abs(s.amount);
  v_net := round(v_gross / (1 + coalesce(v_rate, 0)), 2);
  v_vat := v_gross - v_net;
  v_desc := coalesce(nullif(trim(p_description), ''), s.description);

  if s.amount < 0 then
    v_lines := jsonb_build_array(jsonb_build_object('account_id', a.id, 'debit', v_net, 'description', v_desc));
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(s.company_id, 'vat_input'), 'debit', v_vat, 'description', 'VAT: ' || v_desc); end if;
    v_lines := v_lines || jsonb_build_object('account_id', s.bank_account_id, 'credit', v_gross, 'description', s.description);
  else
    v_lines := jsonb_build_array(jsonb_build_object('account_id', s.bank_account_id, 'debit', v_gross, 'description', s.description));
    v_lines := v_lines || jsonb_build_object('account_id', a.id, 'credit', v_net, 'description', v_desc);
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(s.company_id, 'vat_output'), 'credit', v_vat, 'description', 'VAT: ' || v_desc); end if;
  end if;

  v_journal := public.post_document(s.company_id, 'bank_entry', s.id, s.txn_date, left(v_desc, 200), v_lines);
  select id into v_bank_line from public.journal_lines where journal_id = v_journal and account_id = s.bank_account_id limit 1;
  update public.bank_statement_lines set status = 'matched', journal_line_id = v_bank_line, matched_at = now(), matched_by = auth.uid() where id = s.id;
  return v_journal;
end $$;

-- ---------- reports ----------
-- Movement per account between two dates (posted journals only); p_skip excludes journal source types
create function public.account_movements(p_company uuid, p_from date, p_to date, p_skip text[] default '{}')
returns table (account_id uuid, code text, name text, type public.account_type, system_key text, is_capital boolean, debit numeric, credit numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name, a.type, a.system_key, a.is_capital,
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    from public.accounts a
    join public.journal_lines l on l.account_id = a.id
    join public.journals j on j.id = l.journal_id
   where a.company_id = p_company and j.status = 'posted' and j.journal_date between p_from and p_to
     and not (j.source_type = any (coalesce(p_skip, '{}')))
   group by a.id, a.code, a.name, a.type, a.system_key, a.is_capital;
$$;

create table public.vat_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_from date not null,
  period_to date not null,
  output_tax numeric(18, 2) not null,
  input_tax numeric(18, 2) not null,
  net_payable numeric(18, 2) not null,
  figures jsonb not null,
  sars_reference text,
  journal_id uuid,
  reversal_journal_id uuid,
  filed_by uuid default auth.uid(),
  filed_at timestamptz not null default now(),
  check (period_to >= period_from),
  unique (company_id, id),
  foreign key (company_id, journal_id) references public.journals (company_id, id),
  foreign key (company_id, reversal_journal_id) references public.journals (company_id, id)
);
create index vat_returns_company_idx on public.vat_returns (company_id, period_to desc);

-- VAT201 for a period on the invoice basis. Amounts in base currency.
create function public.vat201(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_f1 numeric; v_f4 numeric; v_f2 numeric; v_f2a numeric; v_f3 numeric;
  v_doc_output numeric;
  v_output numeric; v_input numeric; v_cap_tax numeric; v_cap_net numeric;
  v_filed jsonb;
begin
  if not private.is_member(p_company) then raise exception 'Company not found'; end if;

  with lines as (
    select case when d.doc_type = 'credit_note' then -1 else 1 end as sign,
           round(l.line_subtotal * d.fx_rate, 2) as net, round(l.line_tax * d.fx_rate, 2) as tax,
           tr.code, tr.rate, tr.is_zero_rated
      from public.sales_doc_lines l
      join public.sales_docs d on d.id = l.doc_id
      join public.tax_rates tr on tr.id = l.tax_rate_id
     where d.company_id = p_company and d.doc_type in ('invoice', 'credit_note') and d.journal_id is not null
       and d.issue_date between p_from and p_to
  )
  select coalesce(sum(sign * (net + tax)) filter (where rate > 0), 0),
         coalesce(sum(sign * tax) filter (where rate > 0), 0),
         coalesce(sum(sign * net) filter (where is_zero_rated and code <> 'ZERO'), 0),
         coalesce(sum(sign * net) filter (where is_zero_rated and code = 'ZERO'), 0),
         coalesce(sum(sign * net) filter (where rate = 0 and not is_zero_rated), 0)
    into v_f1, v_doc_output, v_f2, v_f2a, v_f3
    from lines;

  select coalesce(sum(m.credit - m.debit) filter (where m.system_key = 'vat_output'), 0),
         coalesce(sum(m.debit - m.credit) filter (where m.system_key = 'vat_input'), 0)
    into v_output, v_input
    from public.account_movements(p_company, p_from, p_to, array['vat_return']) m;

  -- input VAT on journals that bought capital assets (fixed assets, vehicles kept for use)
  select coalesce(sum(vat.amt), 0), coalesce(sum(cap.amt), 0) into v_cap_tax, v_cap_net
    from public.journals j
    join lateral (select sum(l.debit - l.credit) as amt from public.journal_lines l join public.accounts a on a.id = l.account_id
                   where l.journal_id = j.id and a.system_key = 'vat_input') vat on true
    join lateral (select sum(l.debit - l.credit) as amt from public.journal_lines l join public.accounts a on a.id = l.account_id
                   where l.journal_id = j.id and a.is_capital) cap on true
   where j.company_id = p_company and j.status = 'posted' and j.journal_date between p_from and p_to
     and j.source_type <> 'vat_return' and coalesce(cap.amt, 0) > 0 and coalesce(vat.amt, 0) <> 0;

  select to_jsonb(r) - 'figures' into v_filed from public.vat_returns r
   where r.company_id = p_company and r.reversal_journal_id is null and r.period_from <= p_to and r.period_to >= p_from
   order by r.filed_at desc limit 1;

  v_f4 := v_output;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'field_1', v_f1, 'field_4', v_f4,
    'field_1a', 0, 'field_4a', 0,
    'field_2', v_f2, 'field_2a', v_f2a, 'field_3', v_f3,
    'field_13', v_f4,
    'field_14', v_cap_net + v_cap_tax, 'field_14a', v_cap_tax,
    'field_15', round((v_input - v_cap_tax) * 115 / 15, 2), 'field_15a', v_input - v_cap_tax,
    'field_19', v_input,
    'field_20', v_f4 - v_input,
    'output_from_documents', v_doc_output,
    'output_from_other_entries', v_output - v_doc_output,
    'filed', v_filed);
end $$;

create function public.file_vat_return(p_company uuid, p_from date, p_to date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  v_out numeric; v_in numeric; v_net numeric;
  v_lines jsonb := '[]'::jsonb;
  v_id uuid;
  v_journal uuid;
begin
  if not private.has_role(p_company, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Only owners, admins and accountants can file VAT returns';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a valid VAT period'; end if;
  if exists (select 1 from public.vat_returns where company_id = p_company and reversal_journal_id is null and period_from <= p_to and period_to >= p_from) then
    raise exception 'A VAT return already covers part of this period. Undo it first if it was wrong';
  end if;
  v := public.vat201(p_company, p_from, p_to);
  v_out := (v ->> 'field_13')::numeric;
  v_in := (v ->> 'field_19')::numeric;
  v_net := v_out - v_in;
  if v_out = 0 and v_in = 0 then raise exception 'There is no VAT in this period'; end if;

  insert into public.vat_returns (company_id, period_from, period_to, output_tax, input_tax, net_payable, figures, sars_reference)
  values (p_company, p_from, p_to, v_out, v_in, v_net, v, nullif(trim(p_reference), ''))
  returning id into v_id;

  if v_out > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_output'), 'debit', v_out, 'description', 'Output VAT for the period'); end if;
  if v_out < 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_output'), 'credit', -v_out, 'description', 'Output VAT for the period'); end if;
  if v_in > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_input'), 'credit', v_in, 'description', 'Input VAT for the period'); end if;
  if v_in < 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_input'), 'debit', -v_in, 'description', 'Input VAT for the period'); end if;
  if v_net > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_control'), 'credit', v_net, 'description', 'VAT owed to SARS'); end if;
  if v_net < 0 then v_lines := v_lines || jsonb_build_object('account_id', private.system_account(p_company, 'vat_control'), 'debit', -v_net, 'description', 'VAT refund due from SARS'); end if;

  v_journal := public.post_document(p_company, 'vat_return', v_id, p_to,
    'VAT return ' || to_char(p_from, 'DD Mon YYYY') || ' to ' || to_char(p_to, 'DD Mon YYYY'), v_lines);
  perform set_config('kageflow.system', 'on', true);
  update public.vat_returns set journal_id = v_journal where id = v_id;
  perform set_config('kageflow.system', 'off', true);
  return v_id;
end $$;

create function public.undo_vat_return(p_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.vat_returns;
  v_rev uuid;
begin
  select * into r from public.vat_returns where id = p_id for update;
  if r.id is null or not private.has_role(r.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'VAT return not found, or your role can''t change VAT returns';
  end if;
  if r.reversal_journal_id is not null then raise exception 'This VAT return is already undone'; end if;
  v_rev := public.reverse_journal(r.journal_id, current_date, coalesce(nullif(trim(p_reason), ''), 'VAT return undone'));
  update public.vat_returns set reversal_journal_id = v_rev where id = r.id;
  return v_rev;
end $$;

-- ---------- grants ----------
revoke all on function private.require_bank(uuid) from public;
revoke all on function private.open_bank_ledger_lines(uuid) from public;
revoke all on function public.import_bank_statement(uuid, jsonb) from public, anon;
revoke all on function public.match_bank_line(uuid, uuid) from public, anon;
revoke all on function public.unmatch_bank_line(uuid) from public, anon;
revoke all on function public.ignore_bank_line(uuid, boolean) from public, anon;
revoke all on function public.auto_match_bank(uuid) from public, anon;
revoke all on function public.post_bank_line(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.account_movements(uuid, date, date, text[]) from public, anon;
revoke all on function public.vat201(uuid, date, date) from public, anon;
revoke all on function public.file_vat_return(uuid, date, date, text) from public, anon;
revoke all on function public.undo_vat_return(uuid, text) from public, anon;
grant execute on function public.import_bank_statement(uuid, jsonb) to authenticated;
grant execute on function public.match_bank_line(uuid, uuid) to authenticated;
grant execute on function public.unmatch_bank_line(uuid) to authenticated;
grant execute on function public.ignore_bank_line(uuid, boolean) to authenticated;
grant execute on function public.auto_match_bank(uuid) to authenticated;
grant execute on function public.post_bank_line(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.account_movements(uuid, date, date, text[]) to authenticated;
grant execute on function public.vat201(uuid, date, date) to authenticated;
grant execute on function public.file_vat_return(uuid, date, date, text) to authenticated;
grant execute on function public.undo_vat_return(uuid, text) to authenticated;

-- open ledger lines for the reconciliation screen (members only)
create function public.bank_open_entries(p_bank uuid)
returns table (journal_line_id uuid, journal_id uuid, journal_number text, journal_date date, description text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.accounts where id = p_bank;
  if v_company is null or not private.is_member(v_company) then raise exception 'Bank account not found'; end if;
  return query select * from private.open_bank_ledger_lines(p_bank) o order by o.journal_date desc;
end $$;
revoke all on function public.bank_open_entries(uuid) from public, anon;
grant execute on function public.bank_open_entries(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.bank_statement_lines enable row level security;
alter table public.vat_returns enable row level security;
create policy bank_statement_lines_select on public.bank_statement_lines for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy vat_returns_select on public.vat_returns for select to authenticated using (private.is_member(company_id));
revoke all on public.bank_statement_lines, public.vat_returns from anon;
revoke insert, update on public.bank_statement_lines, public.vat_returns from authenticated;

create trigger audit_bank_statement_lines after insert or update or delete on public.bank_statement_lines for each row execute function private.audit_row();
create trigger audit_vat_returns after insert or update or delete on public.vat_returns for each row execute function private.audit_row();
