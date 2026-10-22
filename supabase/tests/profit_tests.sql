-- Kageflow profit per car and commission tests. Rolled back; report is the final error.
do $test$
declare
  a uuid := gen_random_uuid(); s uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  ca uuid; v_bank uuid; v_payables uuid; v_std uuid; v_vehicle uuid; v_service uuid; v_cust uuid; v_unit uuid; v_tow uuid;
  v_inv uuid; v_inv2 uuid; v_cn uuid; v_app uuid; r record; v_k uuid; v_n numeric; v_n2 numeric; v_cnt int; v_txt text;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-a@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-s@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (s2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-s2@kageflow.test', '', now(), '{}', '{}', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Profit Motors', null, null, '4888888888');
  perform public.add_member_by_email(ca, 'pr-s@kageflow.test', 'sales');
  perform public.add_member_by_email(ca, 'pr-s2@kageflow.test', 'sales');
  insert into public.commission_plans (company_id, user_id, basis, rate) values (ca, s, 'gross_profit_pct', 10);
  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_payables from public.accounts where company_id = ca and system_key = 'payables';
  select id into v_std from public.tax_rates where company_id = ca and code = 'STD';
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  select id into v_service from public.products where company_id = ca and sku = 'SERVICE';
  insert into public.crm_accounts (company_id, name, kind, billing_address) values (ca, 'Buyer', 'customer', '1 Road, Durban') returning id into v_cust;
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, acquired_on) values (ca, v_vehicle, 'AHTFR22G106022222', 'Toyota', 'Hilux', 2021, current_date - 45) returning id into v_unit;
  perform public.add_unit_cost(v_unit, 'purchase', 280000, v_payables, 0);
  perform public.add_unit_cost(v_unit, 'repairs', 20000, v_bank, 0);
  insert into public.products (company_id, sku, name, tracking, tax_rate_id) values (ca, 'TOW', 'Tow bar', 'stock', v_std) returning id into v_tow;
  perform public.receive_stock(v_tow, 2, 1500, v_bank);

  select days_in_stock, landed_cost, recon_cost into v_cnt, v_n, v_n2 from public.vehicle_profit where unit_id = v_unit;
  if v_cnt = 45 and v_n = 300000 and v_n2 = 20000 then pass := pass + 1; out := out || E'\nPASS unsold car: 45 days in stock, R300 000 landed including R20 000 reconditioning';
  else fail := fail + 1; out := out || E'\nFAIL unsold ' || v_cnt || ' ' || v_n || ' ' || v_n2; end if;

  insert into public.sales_docs (company_id, doc_type, account_id, salesperson_id) values (ca, 'invoice', v_cust, s) returning id into v_inv;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, unit_price, tax_rate_id) values (ca, v_inv, 1, v_vehicle, v_unit, 'Hilux', 400000, v_std);
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, description, quantity, unit_price, tax_rate_id) values (ca, v_inv, 2, v_tow, 'Tow bar fitted', 1, 2500, v_std);
  perform public.issue_sales_doc(v_inv);
  select amount, status into v_n, v_txt from public.commissions where invoice_id = v_inv;
  if v_n = 10100 and v_txt = 'pending' then pass := pass + 1; out := out || E'\nPASS commission: 10% of R101 000 gross profit = R10 100 pending for the salesperson';
  else fail := fail + 1; out := out || E'\nFAIL commission ' || coalesce(v_n::text, 'none'); end if;

  insert into public.finance_applications (company_id, account_id, unit_id) values (ca, v_cust, v_unit) returning id into v_app;
  insert into public.finance_submissions (company_id, application_id, bank, status, dic_amount) values (ca, v_app, 'WesBank', 'paid_out', 3000);

  select * into r from public.vehicle_profit where unit_id = v_unit;
  if r.sale_net = 400000 and r.gross_profit = 100000 and r.addon_profit = 1000 and r.finance_income = 3000 and r.commission = 10100
     and r.gross_profit + r.addon_profit + r.finance_income - r.commission = 93900 then
    pass := pass + 1; out := out || E'\nPASS profit per car: R100 000 gross + R1 000 tow bar + R3 000 bank DIC - R10 100 commission = R93 900 net';
  else fail := fail + 1; out := out || E'\nFAIL profit ' || row_to_json(r)::text; end if;

  select id into v_k from public.commissions where invoice_id = v_inv;
  perform public.approve_commissions(array[v_k]);
  select sum(balance) filter (where code = '6050'), sum(balance) filter (where code = '2450') into v_n, v_n2 from public.trial_balance(ca);
  if v_n = 10100 and v_n2 = -10100 then pass := pass + 1; out := out || E'\nPASS approve: commission expensed and owed to the salesperson';
  else fail := fail + 1; out := out || E'\nFAIL approve ' || v_n || ' ' || v_n2; end if;
  perform public.pay_commissions(array[v_k], v_bank, current_date, 'October commission');
  select balance into v_n from public.trial_balance(ca) where code = '2450';
  select status into v_txt from public.commissions where id = v_k;
  if v_n = 0 and v_txt = 'paid' then pass := pass + 1; out := out || E'\nPASS pay: commission paid from the bank, nothing owed';
  else fail := fail + 1; out := out || E'\nFAIL pay ' || v_n || ' ' || v_txt; end if;
  begin
    perform public.cancel_commission(v_k, 'x');
    fail := fail + 1; out := out || E'\nFAIL paid commission cancelled';
  exception when others then pass := pass + 1; out := out || E'\nPASS paid commission can''t be cancelled';
  end;

  -- fully credited invoice cancels its pending commission
  insert into public.sales_docs (company_id, doc_type, account_id, salesperson_id) values (ca, 'invoice', v_cust, s) returning id into v_inv2;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, description, unit_price, tax_rate_id) values (ca, v_inv2, 1, v_service, 'Valet', 1000, v_std);
  perform public.issue_sales_doc(v_inv2);
  v_cn := public.convert_sales_doc(v_inv2, 'credit_note');
  update public.sales_docs set credit_reason = 'Cancelled sale' where id = v_cn;
  perform public.issue_sales_doc(v_cn);
  select status into v_txt from public.commissions where invoice_id = v_inv2;
  if v_txt = 'cancelled' then pass := pass + 1; out := out || E'\nPASS credit note: fully credited sale cancels its pending commission';
  else fail := fail + 1; out := out || E'\nFAIL credit cancel ' || coalesce(v_txt, 'none'); end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.commissions where company_id = ca;
  if v_cnt = 2 then pass := pass + 1; out := out || E'\nPASS salespeople see their own commission'; else fail := fail + 1; out := out || E'\nFAIL own commission count ' || v_cnt; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.commissions where company_id = ca;
  if v_cnt = 0 then pass := pass + 1; out := out || E'\nPASS salespeople can''t see each other''s commission'; else fail := fail + 1; out := out || E'\nFAIL saw others ' || v_cnt; end if;
  execute 'reset role';

  raise exception 'KAGEFLOW PROFIT TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
