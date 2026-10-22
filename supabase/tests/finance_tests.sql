-- Kageflow dealer deal tests: trade-in with settlement, bank finance and payout, invoice settled. Rolled back; report is the final error.
do $test$
declare
  a uuid := gen_random_uuid(); vw uuid := gen_random_uuid();
  ca uuid; v_bank uuid; v_payables uuid; v_std uuid; v_vehicle uuid; v_cust uuid; v_unit uuid;
  v_order uuid; v_inv uuid; v_ti uuid; v_ti2 uuid; v_app uuid; v_sub1 uuid; v_sub2 uuid; v_res jsonb; v_pay uuid;
  v_n numeric; v_n2 numeric; v_n3 numeric; v_txt text; v_cnt int;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fin-a@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (vw, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fin-v@kageflow.test', '', now(), '{}', '{}', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Dealer A', 'Dealer A (Pty) Ltd', null, '4777777777');
  perform public.add_member_by_email(ca, 'fin-v@kageflow.test', 'viewer');
  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_payables from public.accounts where company_id = ca and system_key = 'payables';
  select id into v_std from public.tax_rates where company_id = ca and code = 'STD';
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  insert into public.crm_accounts (company_id, name, kind, billing_address) values (ca, 'Thandi Mokoena', 'customer', '12 Oak St, Pretoria') returning id into v_cust;
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, list_price) values (ca, v_vehicle, 'AHTFR22G106011111', 'Toyota', 'Hilux', 2022, 460000) returning id into v_unit;
  perform public.add_unit_cost(v_unit, 'purchase', 300000, v_payables, 0);

  insert into public.sales_docs (company_id, doc_type, account_id) values (ca, 'order', v_cust) returning id into v_order;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, unit_price, tax_rate_id) values (ca, v_order, 1, v_vehicle, v_unit, '2022 Toyota Hilux', 400000, v_std);
  update public.sales_docs set status = 'open' where id = v_order;

  -- trade-in with negative equity is refused
  insert into public.trade_ins (company_id, account_id, order_id, make, model, year, allowance, settlement_amount) values (ca, v_cust, v_order, 'VW', 'Golf', 2015, 50000, 80000) returning id into v_ti2;
  begin
    perform public.accept_trade_in(v_ti2);
    fail := fail + 1; out := out || E'\nFAIL negative equity accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS negative equity is caught with a clear message';
  end;

  insert into public.trade_ins (company_id, account_id, order_id, vin, make, model, year, mileage_km, allowance, settlement_amount, settlement_bank, settlement_ref)
  values (ca, v_cust, v_order, 'WVWZZZ6RZEY777777', 'VW', 'Polo', 2019, 88000, 115000, 40000, 'WesBank', 'ACC-998') returning id into v_ti;
  v_res := public.accept_trade_in(v_ti);
  select sum(balance) filter (where code = '1200'), sum(balance) filter (where code = '1400'), sum(balance) filter (where code = '2350') into v_n, v_n2, v_n3 from public.trial_balance(ca);
  if (v_res ->> 'credit')::numeric = 75000 and v_n = 400000 and v_n2 = 15000 and v_n3 = -40000 then
    pass := pass + 1; out := out || E'\nPASS trade-in: Polo in stock at R100 000 + R15 000 notional VAT, R75 000 credit to customer, R40 000 owed to WesBank';
  else fail := fail + 1; out := out || E'\nFAIL trade-in ' || v_res::text || ' inv ' || v_n || ' vat ' || v_n2 || ' settle ' || v_n3; end if;
  select stock_no into v_txt from public.inventory_units where id = (v_res ->> 'unit_id')::uuid;
  if v_txt is not null then pass := pass + 1; out := out || E'\nPASS trade-in vehicle has a stock number and is ready to advertise';
  else fail := fail + 1; out := out || E'\nFAIL no stock number'; end if;
  begin
    update public.trade_ins set allowance = 1 where id = v_ti;
    fail := fail + 1; out := out || E'\nFAIL accepted trade-in edited';
  exception when others then pass := pass + 1; out := out || E'\nPASS accepted trade-ins are locked';
  end;
  begin
    perform public.reverse_customer_payment((v_res ->> 'payment_id')::uuid, 'x');
    fail := fail + 1; out := out || E'\nFAIL trade-in credit reversed as a payment';
  exception when others then pass := pass + 1; out := out || E'\nPASS trade-in credit can only be undone with the trade-in';
  end;

  -- finance
  insert into public.finance_applications (company_id, account_id, order_id, unit_id, first_name, last_name, id_number, net_income, purchase_price, trade_in_credit, term_months, consent_at)
  values (ca, v_cust, v_order, v_unit, 'Thandi', 'Mokoena', '9001010000000', 38000, 460000, 75000, 72, now()) returning id into v_app;
  insert into public.finance_submissions (company_id, application_id, bank, reference) values (ca, v_app, 'WesBank', 'W-1') returning id into v_sub1;
  insert into public.finance_submissions (company_id, application_id, bank, reference) values (ca, v_app, 'Absa', 'A-1') returning id into v_sub2;
  update public.finance_submissions set status = 'declined', decided_at = now() where id = v_sub2;
  update public.finance_submissions set status = 'approved', approved_amount = 385000, rate = 12.75, term_months = 72, instalment = 7650, decided_at = now() where id = v_sub1;
  select status into v_txt from public.finance_applications where id = v_app;
  if v_txt = 'approved' then pass := pass + 1; out := out || E'\nPASS finance: Absa declined, WesBank approved, application shows approved';
  else fail := fail + 1; out := out || E'\nFAIL app status ' || v_txt; end if;
  v_pay := public.record_finance_payout(v_sub1, 385000, v_bank);
  select status into v_txt from public.finance_applications where id = v_app;
  if v_txt = 'paid_out' then pass := pass + 1; out := out || E'\nPASS payout: WesBank''s R385 000 recorded on the order, application paid out';
  else fail := fail + 1; out := out || E'\nFAIL payout status ' || v_txt; end if;

  -- invoice settles from trade-in credit + bank payout
  v_inv := public.convert_sales_doc(v_order, 'invoice');
  perform public.issue_sales_doc(v_inv);
  select amount_due into v_n from public.sales_docs where id = v_inv;
  select sum(balance) filter (where code = '1200'), sum(balance) filter (where code = '2200'), sum(balance) filter (where code = '1100') into v_n2, v_n3, v_cnt from public.trial_balance(ca);
  if v_n = 0 and v_n2 = 100000 and v_n3 = 0 and v_cnt = 0 then
    pass := pass + 1; out := out || E'\nPASS invoice R460 000 fully settled by trade-in credit and bank payout; only the Polo left in stock';
  else fail := fail + 1; out := out || E'\nFAIL settle due ' || v_n || ' inv ' || v_n2 || ' deposits ' || v_n3 || ' recv ' || v_cnt; end if;
  begin
    perform public.undo_trade_in(v_ti, 'x');
    fail := fail + 1; out := out || E'\nFAIL undo after invoice';
  exception when others then pass := pass + 1; out := out || E'\nPASS trade-in can''t be undone once its credit paid an invoice';
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.finance_applications where company_id = ca;
  if v_cnt = 0 then pass := pass + 1; out := out || E'\nPASS viewers cannot see finance applications (ID numbers, income)';
  else fail := fail + 1; out := out || E'\nFAIL viewer saw finance apps'; end if;
  execute 'reset role';

  raise exception 'KAGEFLOW FINANCE TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
