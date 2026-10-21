-- Kageflow purchases, banking and VAT tests. Rolled back at the end; the report is the final error message.
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  ca uuid; cb uuid;
  v_bank uuid; v_std uuid; v_rent uuid; v_fuel uuid; v_charges uuid; v_vehicle uuid; v_service uuid;
  v_sup uuid; v_sup_b uuid; v_cust uuid; v_prod uuid; v_unit uuid;
  v_bill uuid; v_bill2 uuid; v_exp uuid; v_usd uuid; v_pay uuid; v_inv uuid; v_ret uuid; v_cost uuid;
  bl public.purchase_bills;
  v_res jsonb; v_n numeric; v_n2 numeric; v_n3 numeric; v_count int;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'buy-a@kageflow.test', '', now(), '{}', '{}', now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'buy-b@kageflow.test', '', now(), '{}', '{}', now(), now()),
    (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'buy-s@kageflow.test', '', now(), '{}', '{}', now(), now());

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Buyer A', 'Buyer A (Pty) Ltd', null, '4999999999');
  perform public.add_member_by_email(ca, 'buy-s@kageflow.test', 'sales');
  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_rent from public.accounts where company_id = ca and code = '6100';
  select id into v_fuel from public.accounts where company_id = ca and code = '6400';
  select id into v_charges from public.accounts where company_id = ca and system_key = 'bank_charges';
  select id into v_std from public.tax_rates where company_id = ca and code = 'STD';
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  select id into v_service from public.products where company_id = ca and sku = 'SERVICE';
  insert into public.crm_accounts (company_id, name, kind) values (ca, 'Parts Supplier', 'supplier') returning id into v_sup;
  insert into public.crm_accounts (company_id, name, kind, billing_address) values (ca, 'Local Customer', 'customer', '1 Main Rd, Durban') returning id into v_cust;
  insert into public.products (company_id, sku, name, tracking, tax_rate_id) values (ca, 'TOW', 'Tow bar', 'stock', v_std) returning id into v_prod;
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, status) values (ca, v_vehicle, 'AHTFR22G106012345', 'Toyota', 'Hilux', 'in_stock') returning id into v_unit;

  -- ===== bill with three kinds of line =====
  v_bill := public.save_bill(null, ca, v_sup, 'INV-555', current_date, null, 'ZAR', 1, null, null, jsonb_build_array(
    jsonb_build_object('kind', 'account', 'account_id', v_rent, 'description', 'October rent', 'quantity', '1', 'unit_price', '10000', 'tax_rate_id', v_std),
    jsonb_build_object('kind', 'stock', 'product_id', v_prod, 'description', 'Tow bars', 'quantity', '10', 'unit_price', '100', 'tax_rate_id', v_std),
    jsonb_build_object('kind', 'vehicle', 'unit_id', v_unit, 'cost_kind', 'transport', 'description', 'Transport Hilux', 'quantity', '1', 'unit_price', '5000', 'tax_rate_id', v_std)));
  select * into bl from public.purchase_bills where id = v_bill;
  if bl.status = 'draft' and bl.total = 18400 then pass := pass + 1; out := out || E'\nPASS bill draft: totals 18 400.00 before posting';
  else fail := fail + 1; out := out || E'\nFAIL bill draft ' || bl.status || ' ' || bl.total; end if;

  begin
    perform public.save_bill(null, ca, v_sup, 'inv-555', current_date, null, 'ZAR', 1, null, null, '[]'::jsonb);
    fail := fail + 1; out := out || E'\nFAIL duplicates: same supplier invoice number accepted twice';
  exception when others then pass := pass + 1; out := out || E'\nPASS duplicates: a supplier''s invoice number can only be entered once';
  end;

  bl := public.post_bill(v_bill);
  select sum(balance) filter (where code = '2000'), sum(balance) filter (where code = '1400'), sum(balance) filter (where code = '1200') into v_n, v_n2, v_n3 from public.trial_balance(ca);
  if bl.status = 'posted' and bl.number like 'BILL-%' and v_n = -18400 and v_n2 = 2400 and v_n3 = 6000 then
    pass := pass + 1; out := out || E'\nPASS bill posted: payables 18 400.00, VAT input 2 400.00, inventory 6 000.00';
  else fail := fail + 1; out := out || E'\nFAIL bill post payables ' || v_n || ' vat ' || v_n2 || ' inv ' || v_n3; end if;
  select qty_on_hand, avg_cost into v_n, v_n2 from public.products where id = v_prod;
  select landed_cost into v_n3 from public.unit_values where unit_id = v_unit;
  if v_n = 10 and v_n2 = 100 and v_n3 = 5000 then pass := pass + 1; out := out || E'\nPASS bill stock: 10 tow bars at 100.00 and R5 000 on the Hilux';
  else fail := fail + 1; out := out || E'\nFAIL bill stock ' || v_n || ' ' || v_n2 || ' ' || v_n3; end if;

  select id into v_cost from public.unit_costs where bill_id = v_bill;
  begin
    perform public.reverse_unit_cost(v_cost, 'test');
    fail := fail + 1; out := out || E'\nFAIL unit cost from a bill reversed on its own';
  exception when others then pass := pass + 1; out := out || E'\nPASS vehicle costs from a bill can only be removed by voiding the bill';
  end;

  -- ===== pay part, overpay, void rules =====
  begin
    perform public.pay_supplier(v_sup, v_bank, jsonb_build_array(jsonb_build_object('bill_id', v_bill, 'amount', 20000)));
    fail := fail + 1; out := out || E'\nFAIL overpayment accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS payments: cannot pay more than is owed';
  end;
  v_pay := public.pay_supplier(v_sup, v_bank, jsonb_build_array(jsonb_build_object('bill_id', v_bill, 'amount', 8400)), current_date, 'ZAR', 1, 'EFT 1', 15);
  select amount_due into v_n from public.purchase_bills where id = v_bill;
  select sum(balance) filter (where code = '1000'), sum(balance) filter (where code = '6600') into v_n2, v_n3 from public.trial_balance(ca);
  if v_n = 10000 and v_n2 = -8415 and v_n3 = 15 then pass := pass + 1; out := out || E'\nPASS supplier payment: 10 000.00 still owed, bank down 8 415.00 incl. R15 charges';
  else fail := fail + 1; out := out || E'\nFAIL supplier payment due ' || v_n || ' bank ' || v_n2 || ' charges ' || v_n3; end if;
  begin
    perform public.void_bill(v_bill, 'wrong');
    fail := fail + 1; out := out || E'\nFAIL paid bill voided';
  exception when others then pass := pass + 1; out := out || E'\nPASS void: a bill with payments must have them reversed first';
  end;
  perform public.reverse_supplier_payment(v_pay, 'test');
  perform public.void_bill(v_bill, 'Entered twice');
  select qty_on_hand into v_n from public.products where id = v_prod;
  select landed_cost into v_n2 from public.unit_values where unit_id = v_unit;
  select sum(balance) filter (where code = '2000'), sum(balance) filter (where code = '1200') into v_n3, v_count from public.trial_balance(ca);
  if v_n = 0 and v_n2 = 0 and v_n3 = 0 and v_count = 0 then pass := pass + 1; out := out || E'\nPASS void: stock, vehicle cost and payables all back to zero';
  else fail := fail + 1; out := out || E'\nFAIL void qty ' || v_n || ' landed ' || v_n2 || ' payables ' || v_n3 || ' inv ' || v_count; end if;

  -- ===== paid-now expense =====
  v_exp := public.save_bill(null, ca, v_sup, null, current_date, null, 'ZAR', 1, v_bank, null, jsonb_build_array(
    jsonb_build_object('kind', 'account', 'account_id', v_fuel, 'description', 'Diesel', 'quantity', '1', 'unit_price', '1000', 'tax_rate_id', v_std)));
  bl := public.post_bill(v_exp);
  if bl.number like 'EXP-%' and bl.amount_due = 0 and bl.amount_paid = 1150 then pass := pass + 1; out := out || E'\nPASS expense: paid from the bank straight away, nothing owed';
  else fail := fail + 1; out := out || E'\nFAIL expense ' || bl.number || ' due ' || bl.amount_due; end if;

  -- ===== USD bill paid at a worse rate =====
  v_usd := public.save_bill(null, ca, v_sup, 'US-1', current_date, null, 'USD', 18, null, null, jsonb_build_array(
    jsonb_build_object('kind', 'account', 'account_id', v_rent, 'description', 'Overseas service', 'quantity', '1', 'unit_price', '1000')));
  perform public.post_bill(v_usd);
  perform public.pay_supplier(v_sup, v_bank, jsonb_build_array(jsonb_build_object('bill_id', v_usd, 'amount', 1000)), current_date, 'USD', 19);
  select sum(balance) filter (where code = '6950'), sum(balance) filter (where code = '2000') into v_n, v_n2 from public.trial_balance(ca);
  if v_n = 1000 and v_n2 = 0 then pass := pass + 1; out := out || E'\nPASS FX: USD 1 000 booked at 18 and paid at 19 posts a R1 000 exchange loss';
  else fail := fail + 1; out := out || E'\nFAIL FX loss ' || v_n || ' payables ' || v_n2; end if;

  -- ===== bank reconciliation =====
  v_res := public.import_bank_statement(v_bank, jsonb_build_array(
    jsonb_build_object('date', current_date::text, 'description', 'SHELL GARAGE', 'amount', '-1150.00'),
    jsonb_build_object('date', current_date::text, 'description', 'MONTHLY FEE', 'amount', '-200'),
    jsonb_build_object('date', current_date::text, 'description', 'MONTHLY FEE', 'amount', '-200'),
    jsonb_build_object('date', 'not a date', 'description', 'junk', 'amount', '5')));
  if (v_res ->> 'added')::int = 3 and (v_res ->> 'unreadable')::int = 1 then pass := pass + 1; out := out || E'\nPASS bank import: 3 lines added (two identical fees kept), 1 unreadable skipped';
  else fail := fail + 1; out := out || E'\nFAIL bank import ' || v_res::text; end if;
  v_res := public.import_bank_statement(v_bank, jsonb_build_array(
    jsonb_build_object('date', current_date::text, 'description', 'SHELL GARAGE', 'amount', '-1150.00')));
  if (v_res ->> 'duplicates')::int = 1 then pass := pass + 1; out := out || E'\nPASS bank import: importing the same statement twice adds nothing';
  else fail := fail + 1; out := out || E'\nFAIL re-import ' || v_res::text; end if;
  v_count := public.auto_match_bank(v_bank);
  if v_count = 1 then pass := pass + 1; out := out || E'\nPASS auto-match: the R1 150 diesel matched to its expense';
  else fail := fail + 1; out := out || E'\nFAIL auto-match count ' || v_count; end if;
  for v_cost in select id from public.bank_statement_lines where company_id = ca and status = 'unmatched' loop
    perform public.post_bank_line(v_cost, v_charges, null, 'Bank fee');
  end loop;
  select count(*) filter (where status = 'unmatched') into v_count from public.bank_statement_lines where company_id = ca;
  select balance into v_n from public.trial_balance(ca) where code = '6600';
  if v_count = 0 and v_n = 400 then pass := pass + 1; out := out || E'\nPASS reconcile: both fees posted to bank charges and matched';
  else fail := fail + 1; out := out || E'\nFAIL reconcile unmatched ' || v_count || ' charges ' || v_n; end if;

  -- ===== VAT201 =====
  insert into public.sales_docs (company_id, doc_type, account_id) values (ca, 'invoice', v_cust) returning id into v_inv;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, description, unit_price, tax_rate_id) values (ca, v_inv, 1, v_service, 'Consulting', 10000, v_std);
  perform public.issue_sales_doc(v_inv);
  v_res := public.vat201(ca, current_date, current_date);
  if (v_res ->> 'field_1')::numeric = 11500 and (v_res ->> 'field_4')::numeric = 1500 and (v_res ->> 'field_19')::numeric = 150
     and (v_res ->> 'field_20')::numeric = 1350 then
    pass := pass + 1; out := out || E'\nPASS VAT201: supplies 11 500, output 1 500, input 150, payable 1 350';
  else fail := fail + 1; out := out || E'\nFAIL VAT201 ' || v_res::text; end if;
  v_ret := public.file_vat_return(ca, current_date, current_date, 'SARS-REF');
  select sum(balance) filter (where code = '2100'), sum(balance) filter (where code = '1400'), sum(balance) filter (where code = '2150') into v_n, v_n2, v_n3 from public.trial_balance(ca);
  if v_n = 0 and v_n2 = 0 and v_n3 = -1350 then pass := pass + 1; out := out || E'\nPASS VAT filed: output and input cleared, R1 350 owed to SARS in VAT control';
  else fail := fail + 1; out := out || E'\nFAIL VAT file out ' || v_n || ' in ' || v_n2 || ' control ' || v_n3; end if;
  begin
    perform public.file_vat_return(ca, current_date, current_date);
    fail := fail + 1; out := out || E'\nFAIL same VAT period filed twice';
  exception when others then pass := pass + 1; out := out || E'\nPASS VAT: the same period cannot be filed twice';
  end;
  v_res := public.vat201(ca, current_date, current_date);
  if (v_res ->> 'field_20')::numeric = 1350 and v_res -> 'filed' is not null and jsonb_typeof(v_res -> 'filed') = 'object' then
    pass := pass + 1; out := out || E'\nPASS VAT report still shows the filed figures and marks the period filed';
  else fail := fail + 1; out := out || E'\nFAIL VAT after filing ' || v_res::text; end if;
  perform public.undo_vat_return(v_ret, 'test');
  select balance into v_n from public.trial_balance(ca) where code = '2150';
  if v_n = 0 then pass := pass + 1; out := out || E'\nPASS VAT undo: VAT control back to zero'; else fail := fail + 1; out := out || E'\nFAIL VAT undo ' || v_n; end if;

  -- ===== P&L check =====
  select sum(credit - debit) filter (where type = 'income'), sum(debit - credit) filter (where type = 'expense')
    into v_n, v_n2 from public.account_movements(ca, current_date, current_date);
  if v_n = 10000 and v_n2 = 20400 then pass := pass + 1; out := out || E'\nPASS P&L movements: income 10 000, expenses 20 400 (voided rent and reversed charges net to zero)';
  else fail := fail + 1; out := out || E'\nFAIL P&L income ' || v_n || ' expense ' || v_n2; end if;
  execute 'reset role';

  -- ===== sales role cannot post bills =====
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.save_bill(null, ca, v_sup, null, current_date, null, 'ZAR', 1, null, null, '[]'::jsonb);
    fail := fail + 1; out := out || E'\nFAIL roles: sales entered a bill';
  exception when others then pass := pass + 1; out := out || E'\nPASS roles: sales cannot enter supplier bills';
  end;
  select count(*) into v_count from public.bank_statement_lines where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS roles: sales cannot see bank statements'; else fail := fail + 1; out := out || E'\nFAIL roles: sales saw bank lines'; end if;
  execute 'reset role';

  -- ===== company B: isolation and non-VAT vendor =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  cb := public.create_company('Small Co B');
  select count(*) into v_count from public.purchase_bills where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B sees none of A''s bills'; else fail := fail + 1; out := out || E'\nFAIL isolation bills'; end if;
  begin
    perform public.pay_supplier(v_sup, v_bank, jsonb_build_array(jsonb_build_object('bill_id', v_usd, 'amount', 1)));
    fail := fail + 1; out := out || E'\nFAIL isolation: B paid A''s supplier';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot pay A''s suppliers';
  end;
  insert into public.crm_accounts (company_id, name, kind) values (cb, 'B Supplier', 'supplier') returning id into v_sup_b;
  v_bill2 := public.save_bill(null, cb, v_sup_b, null, current_date, null, 'ZAR', 1, null, null, jsonb_build_array(
    jsonb_build_object('kind', 'account', 'account_id', (select id from public.accounts where company_id = cb and code = '6100'), 'description', 'Rent',
                       'quantity', '1', 'unit_price', '1000', 'tax_rate_id', (select id from public.tax_rates where company_id = cb and code = 'STD'))));
  perform public.post_bill(v_bill2);
  select sum(balance) filter (where code = '6100'), sum(balance) filter (where code = '1400') into v_n, v_n2 from public.trial_balance(cb);
  if v_n = 1150 and v_n2 = 0 then pass := pass + 1; out := out || E'\nPASS non-VAT vendor: VAT added to the cost, nothing claimed';
  else fail := fail + 1; out := out || E'\nFAIL non-vendor rent ' || v_n || ' vat ' || v_n2; end if;
  execute 'reset role';

  raise exception 'KAGEFLOW PURCHASES TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
