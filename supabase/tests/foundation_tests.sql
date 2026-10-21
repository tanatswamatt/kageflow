-- Kageflow foundation tests: tenant isolation, roles, ledger rules, CRM flow.
-- Runs as real signed-in users (role authenticated + JWT claims) so RLS applies.
-- Everything is rolled back at the end: the report is returned as the final error message.
do $test$
declare
  a uuid := gen_random_uuid();  -- owner of company A
  b uuid := gen_random_uuid();  -- owner of company B
  s uuid := gen_random_uuid();  -- sales member of A
  ca uuid; cb uuid;
  v_lead uuid; v_lead_b uuid; v_result jsonb; v_deal uuid; v_stage_won uuid;
  v_bank uuid; v_capital uuid; v_bank_b uuid;
  v_j uuid; v_j2 uuid; v_rev uuid; v_num text;
  v_count int; v_num2 numeric; v_num3 numeric;
  out text := '';
  pass int := 0; fail int := 0;
begin
  -- ---------- setup (as postgres) ----------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a@kageflow.test', '', now(), '{}', '{"full_name":"Owner A"}', now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-b@kageflow.test', '', now(), '{}', '{"full_name":"Owner B"}', now(), now()),
    (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-s@kageflow.test', '', now(), '{}', '{"full_name":"Sales S"}', now(), now());

  -- ---------- user A creates company A ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Test Co A');
  select count(*) into v_count from public.accounts where company_id = ca;
  if v_count = 39 then pass := pass + 1; out := out || E'\nPASS seed: 39 accounts'; else fail := fail + 1; out := out || E'\nFAIL seed: accounts = ' || v_count; end if;
  select count(*) into v_count from public.crm_pipeline_stages where company_id = ca;
  if v_count = 6 then pass := pass + 1; out := out || E'\nPASS seed: 6 pipeline stages'; else fail := fail + 1; out := out || E'\nFAIL seed: stages = ' || v_count; end if;
  perform public.add_member_by_email(ca, 'test-s@kageflow.test', 'sales');
  insert into public.crm_leads (company_id, first_name, company_name, email, interest, estimated_value)
    values (ca, 'Wanjiru', 'Nairobi Fleet Ltd', 'w@example.test', 'Land Cruiser 79', 650000) returning id into v_lead;
  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_capital from public.accounts where company_id = ca and system_key = 'share_capital';
  execute 'reset role';

  -- ---------- user B creates company B ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  cb := public.create_company('Test Co B');
  insert into public.crm_leads (company_id, first_name, email) values (cb, 'Thabo', 't@example.test') returning id into v_lead_b;
  select id into v_bank_b from public.accounts where company_id = cb and system_key = 'bank';

  -- ISOLATION: B cannot see A
  select count(*) into v_count from public.crm_leads where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B sees 0 of A''s leads'; else fail := fail + 1; out := out || E'\nFAIL isolation: B sees A leads ' || v_count; end if;
  select count(*) into v_count from public.accounts where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B sees 0 of A''s ledger accounts'; else fail := fail + 1; out := out || E'\nFAIL isolation: B sees A accounts'; end if;
  select count(*) into v_count from public.companies where id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B cannot see company A'; else fail := fail + 1; out := out || E'\nFAIL isolation: B sees company A'; end if;
  select count(*) into v_count from public.audit_log where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B sees 0 of A''s audit log'; else fail := fail + 1; out := out || E'\nFAIL isolation: B sees A audit'; end if;

  -- B cannot write into A
  begin
    insert into public.crm_leads (company_id, first_name, email) values (ca, 'Intruder', 'x@example.test');
    fail := fail + 1; out := out || E'\nFAIL isolation: B inserted a lead into A';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B insert into A rejected (' || sqlerrm || ')';
  end;
  update public.crm_leads set first_name = 'Hacked' where id = v_lead;
  get diagnostics v_count = row_count;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B update of A''s lead touched 0 rows'; else fail := fail + 1; out := out || E'\nFAIL isolation: B updated A lead'; end if;
  begin
    perform public.add_member_by_email(ca, 'test-b@kageflow.test', 'owner');
    fail := fail + 1; out := out || E'\nFAIL isolation: B added itself to A';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot add itself to A';
  end;
  begin
    perform public.convert_lead(v_lead);
    fail := fail + 1; out := out || E'\nFAIL isolation: B converted A''s lead';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot convert A''s lead';
  end;
  -- B cannot post into A's ledger through the posting engine
  begin
    perform public.post_document(ca, 'manual', null, current_date, 'x', jsonb_build_array(jsonb_build_object('account_id', v_bank, 'debit', 1), jsonb_build_object('account_id', v_capital, 'credit', 1)));
    fail := fail + 1; out := out || E'\nFAIL isolation: B posted into A';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot post into A''s ledger';
  end;
  execute 'reset role';

  -- ---------- ledger rules as A ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.journals (company_id, description) values (ca, 'Unbalanced') returning id into v_j;
  insert into public.journal_lines (company_id, journal_id, line_no, account_id, debit) values (ca, v_j, 1, v_bank, 100);
  insert into public.journal_lines (company_id, journal_id, line_no, account_id, credit) values (ca, v_j, 2, v_capital, 90);
  begin
    perform public.post_journal(v_j);
    fail := fail + 1; out := out || E'\nFAIL ledger: unbalanced journal posted';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: unbalanced journal rejected (' || sqlerrm || ')';
  end;

  -- cross-tenant account on a line
  begin
    insert into public.journal_lines (company_id, journal_id, line_no, account_id, debit) values (ca, v_j, 3, v_bank_b, 10);
    fail := fail + 1; out := out || E'\nFAIL ledger: line used another company''s account';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: other company''s account rejected on a line';
  end;

  begin
    insert into public.journal_lines (company_id, journal_id, line_no, account_id, debit, credit) values (ca, v_j, 4, v_bank, 5, 5);
    fail := fail + 1; out := out || E'\nFAIL ledger: line with debit and credit accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: line with both debit and credit rejected';
  end;

  update public.journal_lines set credit = 100 where journal_id = v_j and line_no = 2;
  perform public.post_journal(v_j);
  select number into v_num from public.journals where id = v_j;
  if v_num = 'JNL-000001' then pass := pass + 1; out := out || E'\nPASS ledger: balanced journal posted as JNL-000001'; else fail := fail + 1; out := out || E'\nFAIL ledger: number ' || coalesce(v_num, 'null'); end if;

  begin
    update public.journals set description = 'Edited' where id = v_j;
    fail := fail + 1; out := out || E'\nFAIL ledger: posted journal edited';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: posted journal is locked';
  end;
  begin
    update public.journal_lines set debit = 1 where journal_id = v_j and line_no = 1;
    fail := fail + 1; out := out || E'\nFAIL ledger: posted line edited';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: posted lines are locked';
  end;
  begin
    insert into public.journal_lines (company_id, journal_id, line_no, account_id, debit) values (ca, v_j, 9, v_bank, 1);
    fail := fail + 1; out := out || E'\nFAIL ledger: line added to posted journal';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: cannot add lines to a posted journal';
  end;
  begin
    execute format('delete from public.journals where id = %L', v_j);
    fail := fail + 1; out := out || E'\nFAIL ledger: posted journal removed';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: posted journal cannot be removed';
  end;
  begin
    insert into public.journals (company_id, description, status) values (ca, 'Sneaky', 'posted');
    fail := fail + 1; out := out || E'\nFAIL ledger: journal inserted as posted';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: journals cannot be born posted';
  end;

  select sum(debit) - sum(credit) into v_num2 from public.trial_balance(ca);
  select sum(balance) filter (where code = '1000') into v_num3 from public.trial_balance(ca);
  if v_num2 = 0 and v_num3 = 100 then pass := pass + 1; out := out || E'\nPASS ledger: trial balance balances, bank = 100.00'; else fail := fail + 1; out := out || E'\nFAIL ledger: TB diff ' || v_num2 || ' bank ' || v_num3; end if;

  v_rev := public.reverse_journal(v_j, current_date, 'test');
  select sum(balance) filter (where code = '1000') into v_num3 from public.trial_balance(ca);
  select reversed_by into v_j2 from public.journals where id = v_j;
  if v_num3 = 0 and v_j2 = v_rev then pass := pass + 1; out := out || E'\nPASS ledger: reversal posted and nets bank to 0'; else fail := fail + 1; out := out || E'\nFAIL ledger: reversal bank ' || v_num3; end if;
  begin
    perform public.reverse_journal(v_j);
    fail := fail + 1; out := out || E'\nFAIL ledger: journal reversed twice';
  exception when others then pass := pass + 1; out := out || E'\nPASS ledger: a journal can only be reversed once';
  end;

  -- posting engine with rule keys
  v_j2 := public.post_document(ca, 'sales_invoice', null, current_date, 'Test invoice',
    jsonb_build_array(jsonb_build_object('key', 'receivable', 'debit', 115), jsonb_build_object('key', 'revenue', 'credit', 100), jsonb_build_object('key', 'vat', 'credit', 15)));
  select sum(balance) filter (where code = '2100') into v_num3 from public.trial_balance(ca);
  if v_num3 = -15 then pass := pass + 1; out := out || E'\nPASS posting engine: invoice rules hit receivables, sales and VAT output'; else fail := fail + 1; out := out || E'\nFAIL posting engine: VAT ' || v_num3; end if;

  -- locked period blocks posting
  insert into public.fiscal_periods (company_id, name, start_date, end_date, status) values (ca, 'Locked test', current_date - 400, current_date - 370, 'locked');
  begin
    perform public.post_document(ca, 'manual', null, current_date - 380, 'Back-dated',
      jsonb_build_array(jsonb_build_object('account_id', v_bank, 'debit', 1), jsonb_build_object('account_id', v_capital, 'credit', 1)));
    fail := fail + 1; out := out || E'\nFAIL periods: posted into a locked period';
  exception when others then pass := pass + 1; out := out || E'\nPASS periods: locked period rejects postings (' || sqlerrm || ')';
  end;

  -- system accounts protected
  begin
    update public.accounts set type = 'expense' where id = v_bank;
    fail := fail + 1; out := out || E'\nFAIL accounts: system account type changed';
  exception when others then pass := pass + 1; out := out || E'\nPASS accounts: system accounts keep their type';
  end;

  -- CRM flow
  v_result := public.convert_lead(v_lead);
  v_deal := (v_result ->> 'deal_id')::uuid;
  if v_deal is not null and (v_result ->> 'account_id') is not null and (v_result ->> 'contact_id') is not null then
    pass := pass + 1; out := out || E'\nPASS crm: lead converted to account, contact and deal';
  else fail := fail + 1; out := out || E'\nFAIL crm: convert result ' || v_result::text; end if;
  select value into v_num3 from public.crm_deals where id = v_deal;
  if v_num3 = 650000 then pass := pass + 1; out := out || E'\nPASS crm: deal carries the lead''s estimated value'; else fail := fail + 1; out := out || E'\nFAIL crm: deal value ' || v_num3; end if;
  select id into v_stage_won from public.crm_pipeline_stages where company_id = ca and is_won;
  update public.crm_deals set stage_id = v_stage_won where id = v_deal;
  select count(*) into v_count from public.crm_deals where id = v_deal and status = 'won' and closed_at is not null;
  if v_count = 1 then pass := pass + 1; out := out || E'\nPASS crm: moving to Won closes the deal'; else fail := fail + 1; out := out || E'\nFAIL crm: deal not won'; end if;
  select count(*) into v_count from public.crm_activities where account_id = (v_result ->> 'account_id')::uuid and type = 'system';
  if v_count >= 3 then pass := pass + 1; out := out || E'\nPASS crm: account timeline shows conversion, creation and stage change (' || v_count || ')'; else fail := fail + 1; out := out || E'\nFAIL crm: timeline entries ' || v_count; end if;
  begin
    insert into public.crm_activities (company_id, type, subject, account_id) values (ca, 'system', 'Fake system entry', (v_result ->> 'account_id')::uuid);
    fail := fail + 1; out := out || E'\nFAIL crm: client wrote a system activity';
  exception when others then pass := pass + 1; out := out || E'\nPASS crm: clients cannot forge system timeline entries';
  end;

  select count(*) into v_count from public.audit_log where company_id = ca;
  if v_count > 0 then pass := pass + 1; out := out || E'\nPASS audit: ' || v_count || ' audit entries recorded for A'; else fail := fail + 1; out := out || E'\nFAIL audit: none'; end if;
  begin
    update public.audit_log set action = 'INSERT' where company_id = ca;
    get diagnostics v_count = row_count;
    if v_count = 0 then pass := pass + 1; out := out || E'\nPASS audit: entries cannot be edited'; else fail := fail + 1; out := out || E'\nFAIL audit: edited'; end if;
  exception when others then pass := pass + 1; out := out || E'\nPASS audit: entries cannot be edited';
  end;
  execute 'reset role';

  -- ---------- roles: sales member S in company A ----------
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.crm_leads (company_id, first_name, email) values (ca, 'From sales', 's@example.test');
  pass := pass + 1; out := out || E'\nPASS roles: sales can add leads';
  begin
    insert into public.journals (company_id, description) values (ca, 'Sales tries the books');
    fail := fail + 1; out := out || E'\nFAIL roles: sales wrote a journal';
  exception when others then pass := pass + 1; out := out || E'\nPASS roles: sales cannot write journals';
  end;
  select count(*) into v_count from public.audit_log where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS roles: sales cannot read the audit log'; else fail := fail + 1; out := out || E'\nFAIL roles: sales reads audit'; end if;
  begin
    perform public.set_member_role(ca, s, 'owner');
    fail := fail + 1; out := out || E'\nFAIL roles: sales promoted itself';
  exception when others then pass := pass + 1; out := out || E'\nPASS roles: sales cannot promote itself';
  end;
  execute 'reset role';

  raise exception 'KAGEFLOW TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
