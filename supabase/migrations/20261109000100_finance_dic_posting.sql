-- Finance house commission (DIC) in the books.
-- * The DIC on a bank's answer is excluding VAT. When the bank pays out the car, the DIC is posted as income the bank owes:
--     Dr Finance commission due from banks (incl. VAT) / Cr Finance and insurance commission / Cr VAT output
--   (no VAT when the dealer isn't VAT registered). It can also be posted by hand, and undone with a reversal.
-- * When the bank pays the DIC (often one payment for a month's statement):
--     Dr Bank / Cr Finance commission due from banks
-- * The VAT201 counts the DIC as a standard-rated supply.

alter table public.finance_submissions
  add column dic_vat numeric(18, 2),
  add column dic_journal_id uuid,
  add column dic_received_journal_id uuid,
  add column dic_received_on date,
  add column dic_reference text;

-- the account the banks' DIC sits in until they pay it
insert into public.accounts (company_id, code, name, type, system_key, is_system)
select c.id, '1150', 'Finance commission due from banks', 'asset'::public.account_type, 'dic_receivable', true
  from public.companies c
 where not exists (select 1 from public.accounts a where a.company_id = c.id and (a.system_key = 'dic_receivable' or a.code = '1150'));

do $$
declare
  v_def text := pg_get_functiondef('private.seed_company(uuid)'::regprocedure);
begin
  if v_def !~ 'end\s*\$function\$\s*$' then raise exception 'seed_company: end anchor not found'; end if;
  v_def := regexp_replace(v_def, 'end\s*\$function\$\s*$',
    E'  insert into public.accounts (company_id, code, name, type, system_key, is_system)\n  values (p_company, ''1150'', ''Finance commission due from banks'', ''asset'', ''dic_receivable'', true)\n  on conflict do nothing;\nend $function$\n');
  execute v_def;
end $$;

-- Post a deal's DIC (once). Called on payout, or by hand after the DIC is filled in.
create or replace function public.post_finance_dic(p_submission uuid, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.finance_submissions;
  a public.finance_applications;
  c public.companies;
  v_vat numeric := 0;
  v_j uuid;
  v_unit text;
begin
  select * into s from public.finance_submissions where id = p_submission for update;
  if s.id is null or not private.has_role(s.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bank answer not found, or only owners, admins and accountants can post finance commission';
  end if;
  if s.dic_journal_id is not null then raise exception 'This DIC is already in the books'; end if;
  if coalesce(s.dic_amount, 0) <= 0 then raise exception 'Enter the DIC on the bank''s answer first'; end if;
  if s.status not in ('paid_out', 'contracted') then raise exception 'Post the DIC once the bank has contracted or paid out the deal'; end if;
  select * into a from public.finance_applications where id = s.application_id;
  select * into c from public.companies where id = s.company_id;
  if nullif(trim(coalesce(c.vat_no, '')), '') is not null then
    v_vat := round(s.dic_amount * private.vat_rate(s.company_id), 2);
  end if;
  select coalesce(u.stock_no, '') into v_unit from public.inventory_units u where u.id = a.unit_id;

  v_j := public.post_document(s.company_id, 'finance_dic', s.id, coalesce(p_date, s.payout_date, current_date),
    left('Finance commission from ' || s.bank || coalesce(' on ' || nullif(v_unit, ''), '') || coalesce(' (' || a.number || ')', ''), 300),
    jsonb_build_array(
      jsonb_build_object('account_id', private.system_account(s.company_id, 'dic_receivable'), 'debit', s.dic_amount + v_vat),
      jsonb_build_object('account_id', private.system_account(s.company_id, 'fi_income'), 'credit', s.dic_amount)
    ) || case when v_vat > 0 then jsonb_build_array(jsonb_build_object('account_id', private.system_account(s.company_id, 'vat_output'), 'credit', v_vat)) else '[]'::jsonb end,
    c.base_currency, 1);
  update public.finance_submissions set dic_journal_id = v_j, dic_vat = v_vat where id = s.id;
  return v_j;
end $$;

-- Undo a posted DIC that hasn't been paid (wrong amount): reverses the entry so it can be posted again
create or replace function public.undo_finance_dic(p_submission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.finance_submissions;
begin
  select * into s from public.finance_submissions where id = p_submission for update;
  if s.id is null or not private.has_role(s.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Bank answer not found, or only owners, admins and accountants can change finance commission';
  end if;
  if s.dic_journal_id is null then raise exception 'This DIC isn''t in the books'; end if;
  if s.dic_received_journal_id is not null then raise exception 'The bank has already paid this DIC'; end if;
  perform public.reverse_journal(s.dic_journal_id, current_date, 'DIC corrected');
  update public.finance_submissions set dic_journal_id = null, dic_vat = null where id = s.id;
end $$;

-- One bank payment for one or more DICs (usually the bank's monthly statement)
create or replace function public.receive_finance_dic(p_submissions uuid[], p_bank_account uuid, p_date date default current_date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_total numeric;
  v_banks text;
  v_j uuid;
begin
  select min(company_id::text)::uuid, sum(dic_amount + coalesce(dic_vat, 0)), string_agg(distinct bank, ', ')
    into v_company, v_total, v_banks
    from public.finance_submissions where id = any (p_submissions);
  if v_company is null then raise exception 'Choose the commission the bank paid'; end if;
  if exists (select 1 from public.finance_submissions where id = any (p_submissions)
              and (company_id <> v_company or dic_journal_id is null or dic_received_journal_id is not null)) then
    raise exception 'Only commission that is in the books and not yet paid can be received';
  end if;
  if not private.has_role(v_company, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Only owners, admins and accountants can record money received';
  end if;
  if not exists (select 1 from public.accounts where id = p_bank_account and company_id = v_company and type = 'asset' and is_active) then
    raise exception 'Pick the bank account it was paid into';
  end if;
  v_j := public.post_document(v_company, 'finance_dic_receipt', p_submissions[1], p_date,
    left('Finance commission received from ' || v_banks || coalesce(' · ' || nullif(trim(p_reference), ''), ''), 300),
    jsonb_build_array(
      jsonb_build_object('account_id', p_bank_account, 'debit', v_total),
      jsonb_build_object('account_id', private.system_account(v_company, 'dic_receivable'), 'credit', v_total)),
    (select base_currency from public.companies where id = v_company), 1);
  update public.finance_submissions set dic_received_journal_id = v_j, dic_received_on = p_date, dic_reference = nullif(trim(p_reference), '')
   where id = any (p_submissions);
  return v_j;
end $$;

revoke all on function public.post_finance_dic(uuid, date) from public, anon;
revoke all on function public.undo_finance_dic(uuid) from public, anon;
revoke all on function public.receive_finance_dic(uuid[], uuid, date, text) from public, anon;
grant execute on function public.post_finance_dic(uuid, date) to authenticated;
grant execute on function public.undo_finance_dic(uuid) to authenticated;
grant execute on function public.receive_finance_dic(uuid[], uuid, date, text) to authenticated;

-- Payout posts the DIC too, when there is one
do $$
declare
  v_def text := pg_get_functiondef('public.record_finance_payout(uuid, numeric, uuid, date)'::regprocedure);
  a text := 'update public.finance_submissions set status = ''paid_out'', payout_amount = p_amount, payout_date = p_date, payment_id = v_pay, decided_at = coalesce(decided_at, now()) where id = s.id;';
begin
  if position(a in v_def) = 0 then raise exception 'record_finance_payout: anchor not found'; end if;
  v_def := replace(v_def, a, a || '
  if coalesce(s.dic_amount, 0) > 0 and s.dic_journal_id is null then
    perform public.post_finance_dic(s.id, p_date);
  end if;');
  execute v_def;
end $$;

-- VAT201 field 1 includes the DIC (standard-rated supply to the bank); field 4 already reads VAT output from the ledger
do $$
declare
  v_def text := pg_get_functiondef('public.vat201(uuid, date, date)'::regprocedure);
  a text := 'into v_f1, v_doc_output, v_f2, v_f2a, v_f3
    from lines;';
begin
  if position(a in v_def) = 0 then raise exception 'vat201: anchor not found'; end if;
  v_def := replace(v_def, a, a || '

  -- finance house commission billed to the banks
  v_f1 := v_f1 + coalesce((
    select sum(l.credit - l.debit)
      from public.journals j
      join public.journal_lines l on l.journal_id = j.id
      join public.accounts ac on ac.id = l.account_id
     where j.company_id = p_company and j.status = ''posted'' and j.source_type = ''finance_dic''
       and j.journal_date between p_from and p_to and ac.system_key in (''fi_income'', ''vat_output'')
       and exists (select 1 from public.journal_lines v join public.accounts va on va.id = v.account_id
                    where v.journal_id = j.id and va.system_key = ''vat_output'')), 0);
  v_doc_output := v_doc_output + coalesce((
    select sum(l.credit - l.debit)
      from public.journals j
      join public.journal_lines l on l.journal_id = j.id
      join public.accounts ac on ac.id = l.account_id
     where j.company_id = p_company and j.status = ''posted'' and j.source_type = ''finance_dic''
       and j.journal_date between p_from and p_to and ac.system_key = ''vat_output''), 0);');
  execute v_def;
end $$;

-- Only the functions above may set the DIC's ledger links; a posted DIC's amount can't change until it is undone
create or replace function private.guard_finance_dic()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('kageflow.dic', true), '') <> 'on' then
    if row(new.dic_journal_id, new.dic_received_journal_id, new.dic_vat, new.dic_received_on, new.dic_reference)
       is distinct from row(old.dic_journal_id, old.dic_received_journal_id, old.dic_vat, old.dic_received_on, old.dic_reference) then
      raise exception 'Finance commission is posted from the finance application, not edited directly';
    end if;
  end if;
  if old.dic_journal_id is not null and new.dic_journal_id is not null and new.dic_amount is distinct from old.dic_amount then
    raise exception 'The DIC is already in the books. Undo it first, then change it';
  end if;
  return new;
end $$;
create trigger finance_submissions_guard_dic before update on public.finance_submissions
  for each row execute function private.guard_finance_dic();

do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['public.post_finance_dic(uuid, date)', 'public.undo_finance_dic(uuid)', 'public.receive_finance_dic(uuid[], uuid, date, text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('begin' in v_def) = 0 then raise exception '% : no begin', f; end if;
    v_def := regexp_replace(v_def, '\mbegin\M', E'begin\n  perform set_config(''kageflow.dic'', ''on'', true);', '');
    execute v_def;
  end loop;
end $$;
