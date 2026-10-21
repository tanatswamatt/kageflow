-- Kageflow sales tests: landed cost, USD quote -> order -> deposit -> invoice -> FX, credit note, SARS check,
-- API intake, webhooks, isolation and roles. Rolled back at the end; the report is the final error message.
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  ca uuid; cb uuid;
  v_bank uuid; v_payables uuid; v_std uuid; v_zero uuid; v_vehicle uuid;
  v_cust uuid; v_cust2 uuid; v_unit uuid; v_unit2 uuid;
  v_quote uuid; v_order uuid; v_inv uuid; v_inv2 uuid; v_cn uuid; v_pay uuid; v_pay2 uuid;
  v_key text; v_res jsonb; v_endpoint uuid;
  d public.sales_docs;
  v_n numeric; v_n2 numeric; v_count int; v_text text;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sales-a@kageflow.test', '', now(), '{}', '{}', now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sales-b@kageflow.test', '', now(), '{}', '{}', now(), now()),
    (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sales-s@kageflow.test', '', now(), '{}', '{}', now(), now());

  -- ===== owner A =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Exporter A', 'Exporter A (Pty) Ltd', null, '4123456789');
  perform public.add_member_by_email(ca, 'sales-s@kageflow.test', 'sales');
  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_payables from public.accounts where company_id = ca and system_key = 'payables';
  select id into v_std from public.tax_rates where company_id = ca and code = 'STD';
  select id into v_zero from public.tax_rates where company_id = ca and code = 'ZERO';
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  if v_std is not null and v_zero is not null and v_vehicle is not null then pass := pass + 1; out := out || E'\nPASS seed: tax rates and vehicle product created';
  else fail := fail + 1; out := out || E'\nFAIL seed: catalog missing'; end if;

  insert into public.crm_accounts (company_id, name, kind, billing_address, vat_no) values (ca, 'Nairobi Fleet Ltd', 'customer', 'Mombasa Rd, Nairobi, Kenya', null) returning id into v_cust;
  insert into public.crm_accounts (company_id, name, kind) values (ca, 'Local Buyer (no address)', 'customer') returning id into v_cust2;

  -- vehicle + landed cost
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, status) values (ca, v_vehicle, 'JTEBX3FJ70K123456', 'Toyota', 'Land Cruiser 79', 2022, 'in_stock') returning id into v_unit;
  perform public.add_unit_cost(v_unit, 'purchase', 200000, v_payables, 0);
  perform public.add_unit_cost(v_unit, 'transport', 10000, v_bank, 1500);
  select landed_cost into v_n from public.unit_values where unit_id = v_unit;
  select sum(balance) filter (where code = '1200'), sum(balance) filter (where code = '1400') into v_n, v_n2 from public.trial_balance(ca);
  if v_n = 210000 and v_n2 = 1500 then pass := pass + 1; out := out || E'\nPASS landed cost: inventory 210 000.00 and VAT input 1 500.00 posted';
  else fail := fail + 1; out := out || E'\nFAIL landed cost: inventory ' || v_n || ' vat ' || v_n2; end if;
  begin
    update public.inventory_units set status = 'sold' where id = v_unit;
    fail := fail + 1; out := out || E'\nFAIL units: marked sold by hand';
  exception when others then pass := pass + 1; out := out || E'\nPASS units: only an invoice can mark a unit sold';
  end;

  -- USD quote at 18.00
  insert into public.sales_docs (company_id, doc_type, account_id, currency, fx_rate, reference) values (ca, 'quote', v_cust, 'USD', 18, 'KAL-ORD-1001') returning id into v_quote;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, unit_price, tax_rate_id)
    values (ca, v_quote, 1, v_vehicle, v_unit, 'Toyota Land Cruiser 79 2022 (used) VIN JTEBX3FJ70K123456', 20000, v_zero);
  select total into v_n from public.sales_docs where id = v_quote;
  if v_n = 20000 then pass := pass + 1; out := out || E'\nPASS quote: zero-rated export line totals USD 20 000'; else fail := fail + 1; out := out || E'\nFAIL quote total ' || v_n; end if;
  begin
    insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, description, unit_price, tax_rate_id) values (ca, v_quote, 2, v_vehicle, 'Vehicle without VIN', 1, v_std);
    fail := fail + 1; out := out || E'\nFAIL lines: serial product without unit accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS lines: a vehicle line must name its VIN';
  end;
  update public.sales_docs set status = 'sent' where id = v_quote;
  select number into v_text from public.sales_docs where id = v_quote;
  if v_text = 'QUO-000001' then pass := pass + 1; out := out || E'\nPASS quote: numbered QUO-000001 when sent'; else fail := fail + 1; out := out || E'\nFAIL quote number ' || coalesce(v_text, 'null'); end if;
  begin
    update public.sales_doc_lines set unit_price = 1 where doc_id = v_quote;
    fail := fail + 1; out := out || E'\nFAIL quote: sent quote edited';
  exception when others then pass := pass + 1; out := out || E'\nPASS quote: sent quotes are locked';
  end;

  -- order, reserve unit
  v_order := public.convert_sales_doc(v_quote, 'order');
  update public.sales_docs set status = 'open' where id = v_order;
  select status::text into v_text from public.inventory_units where id = v_unit;
  if v_text = 'reserved' then pass := pass + 1; out := out || E'\nPASS order: confirming reserves the vehicle'; else fail := fail + 1; out := out || E'\nFAIL order: unit ' || v_text; end if;
  select status::text into v_text from public.sales_docs where id = v_quote;
  if v_text = 'accepted' then pass := pass + 1; out := out || E'\nPASS quote: converting marks it accepted'; else fail := fail + 1; out := out || E'\nFAIL quote status ' || v_text; end if;

  -- webhook endpoint (request is queued then rolled back with the test)
  insert into public.webhook_endpoints (company_id, url) values (ca, 'https://example.com/kageflow-hook') returning id into v_endpoint;
  update public.sales_docs set tracking_stage = 'In transit to Beitbridge' where id = v_order;
  select count(*) into v_count from public.webhook_deliveries where endpoint_id = v_endpoint and event = 'order.updated';
  if v_count = 1 then pass := pass + 1; out := out || E'\nPASS webhooks: tracking change queued an order.updated delivery'; else fail := fail + 1; out := out || E'\nFAIL webhooks: deliveries ' || v_count; end if;

  -- deposit USD 5 000 at 18.00 against the order
  v_pay := public.record_customer_payment(v_cust, 5000, v_bank, 'USD', 18, current_date, 'eft', 'Deposit', v_order, '[]');
  select sum(balance) filter (where code = '2200') into v_n from public.trial_balance(ca);
  if v_n = -90000 then pass := pass + 1; out := out || E'\nPASS deposit: held as a R90 000 liability until invoiced'; else fail := fail + 1; out := out || E'\nFAIL deposit liability ' || v_n; end if;

  -- invoice from order at 18.50
  v_inv := public.convert_sales_doc(v_order, 'invoice');
  update public.sales_docs set fx_rate = 18.5 where id = v_inv;
  d := public.issue_sales_doc(v_inv);
  if d.number = 'INV-000001' and d.amount_paid = 5000 and d.amount_due = 15000 then
    pass := pass + 1; out := out || E'\nPASS invoice: INV-000001 issued and the order deposit applied automatically (USD 15 000 due)';
  else fail := fail + 1; out := out || E'\nFAIL invoice: ' || coalesce(d.number, 'null') || ' paid ' || d.amount_paid || ' due ' || d.amount_due; end if;
  select status::text into v_text from public.inventory_units where id = v_unit;
  if v_text = 'sold' then pass := pass + 1; out := out || E'\nPASS invoice: vehicle marked sold'; else fail := fail + 1; out := out || E'\nFAIL unit ' || v_text; end if;
  select status::text into v_text from public.sales_docs where id = v_order;
  if v_text = 'fulfilled' then pass := pass + 1; out := out || E'\nPASS invoice: order marked fulfilled'; else fail := fail + 1; out := out || E'\nFAIL order ' || v_text; end if;
  -- 4100 export sales = -370 000 (20 000 x 18.5); COGS 210 000; inventory 0; FX loss 2 500 (deposit 90 000 vs receivable 92 500)
  select sum(balance) filter (where code = '6950') into v_n from public.trial_balance(ca);
  select sum(balance) filter (where code = '4100') into v_n2 from public.trial_balance(ca);
  if v_n = 2500 and v_n2 = -370000 then pass := pass + 1; out := out || E'\nPASS FX: export sale R370 000 at 18.50; deposit at 18.00 gives realised loss R2 500';
  else fail := fail + 1; out := out || E'\nFAIL FX: loss ' || v_n || ' sales ' || v_n2; end if;
  select sum(balance) filter (where code = '5000') into v_n from public.trial_balance(ca);
  select sum(balance) filter (where code = '1200') into v_n2 from public.trial_balance(ca);
  if v_n = 210000 and v_n2 = 0 then pass := pass + 1; out := out || E'\nPASS COGS: landed cost R210 000 moved from inventory to cost of sales';
  else fail := fail + 1; out := out || E'\nFAIL COGS ' || v_n || ' inventory ' || v_n2; end if;
  begin
    update public.sales_docs set notes = 'edit' where id = v_inv;
    fail := fail + 1; out := out || E'\nFAIL invoice: issued invoice edited';
  exception when others then pass := pass + 1; out := out || E'\nPASS invoice: issued invoices are locked';
  end;

  -- balance USD 15 000 at 19.00
  v_pay2 := public.record_customer_payment(v_cust, 15000, v_bank, 'USD', 19, current_date, 'eft', 'Balance', null, jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount', 15000)));
  select amount_due into v_n from public.sales_docs where id = v_inv;
  select sum(balance) filter (where code = '4950') into v_n2 from public.trial_balance(ca);
  if v_n = 0 and v_n2 = -7500 then pass := pass + 1; out := out || E'\nPASS FX: balance at 19.00 settles the invoice with a realised gain of R7 500';
  else fail := fail + 1; out := out || E'\nFAIL settle: due ' || v_n || ' gain ' || v_n2; end if;
  select sum(balance) filter (where code = '1100'), sum(balance) filter (where code = '2200') into v_n, v_n2 from public.trial_balance(ca);
  if v_n = 0 and v_n2 = 0 then pass := pass + 1; out := out || E'\nPASS ledger: receivables and customer deposits both back to zero';
  else fail := fail + 1; out := out || E'\nFAIL ledger: receivables ' || v_n || ' deposits ' || v_n2; end if;
  begin
    perform public.allocate_payment(v_pay2, v_inv, 1);
    fail := fail + 1; out := out || E'\nFAIL payments: over-allocated';
  exception when others then pass := pass + 1; out := out || E'\nPASS payments: cannot allocate more than is owed or unallocated';
  end;

  -- ZAR invoice with VAT, SARS full-invoice check, credit note
  insert into public.sales_docs (company_id, doc_type, account_id) values (ca, 'invoice', v_cust2) returning id into v_inv2;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, description, quantity, unit_price, tax_rate_id) values (ca, v_inv2, 1, 'Export documentation service', 2, 5000, v_std);
  select total, tax_total into v_n, v_n2 from public.sales_docs where id = v_inv2;
  if v_n = 11500 and v_n2 = 1500 then pass := pass + 1; out := out || E'\nPASS VAT: 2 x R5 000 at 15% = R11 500 incl. R1 500 VAT'; else fail := fail + 1; out := out || E'\nFAIL VAT total ' || v_n; end if;
  begin
    perform public.issue_sales_doc(v_inv2);
    fail := fail + 1; out := out || E'\nFAIL SARS: invoice over R5 000 issued without customer address';
  exception when others then pass := pass + 1; out := out || E'\nPASS SARS: over R5 000 needs the customer address (' || sqlerrm || ')';
  end;
  update public.crm_accounts set billing_address = '12 Main Rd, Durban' where id = v_cust2;
  d := public.issue_sales_doc(v_inv2);
  if d.bill_to_address = '12 Main Rd, Durban' then pass := pass + 1; out := out || E'\nPASS invoice: customer details are frozen onto the issued invoice'; else fail := fail + 1; out := out || E'\nFAIL bill_to'; end if;
  v_cn := public.convert_sales_doc(v_inv2, 'credit_note');
  update public.sales_doc_lines set quantity = 1 where doc_id = v_cn;
  begin
    perform public.issue_sales_doc(v_cn);
    fail := fail + 1; out := out || E'\nFAIL credit note: issued without reason';
  exception when others then pass := pass + 1; out := out || E'\nPASS credit note: a reason is required';
  end;
  update public.sales_docs set credit_reason = 'One document set not needed' where id = v_cn;
  d := public.issue_sales_doc(v_cn);
  select amount_due into v_n from public.sales_docs where id = v_inv2;
  select sum(balance) filter (where code = '2100') into v_n2 from public.trial_balance(ca);
  if d.number = 'CN-000001' and v_n = 5750 and v_n2 = -750 then pass := pass + 1; out := out || E'\nPASS credit note: CN-000001 halves the invoice and reverses half the VAT';
  else fail := fail + 1; out := out || E'\nFAIL credit note: ' || coalesce(d.number, 'null') || ' due ' || v_n || ' vat ' || v_n2; end if;

  select sum(debit) - sum(credit) into v_n from public.trial_balance(ca);
  if v_n = 0 then pass := pass + 1; out := out || E'\nPASS ledger: trial balance still balances after the full cycle'; else fail := fail + 1; out := out || E'\nFAIL TB diff ' || v_n; end if;

  select count(*) into v_count from public.webhook_deliveries where endpoint_id = v_endpoint and event in ('invoice.issued', 'payment.received', 'credit_note.issued');
  if v_count >= 4 then pass := pass + 1; out := out || E'\nPASS webhooks: invoice, credit note and payment events queued (' || v_count || ')'; else fail := fail + 1; out := out || E'\nFAIL webhook events ' || v_count; end if;

  v_key := public.create_api_key(ca, 'Kalali website');
  select (public.shared_sales_doc(d.share_token) -> 'doc' ->> 'number') into v_text;
  if v_text = 'CN-000001' then pass := pass + 1; out := out || E'\nPASS sharing: issued document readable by its share link'; else fail := fail + 1; out := out || E'\nFAIL share ' || coalesce(v_text, 'null'); end if;
  execute 'reset role';

  -- ===== anonymous website =====
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  v_res := public.api_submit_lead(v_key, '{"first_name":"Amina","email":"amina@example.test","interest":"Hilux","external_ref":"form-77","consent":true}');
  if v_res ->> 'status' = 'created' then pass := pass + 1; out := out || E'\nPASS API: website lead accepted with an API key'; else fail := fail + 1; out := out || E'\nFAIL API ' || v_res::text; end if;
  v_res := public.api_submit_lead(v_key, '{"first_name":"Amina","email":"amina@example.test","external_ref":"form-77"}');
  if v_res ->> 'status' = 'existing' then pass := pass + 1; out := out || E'\nPASS API: resubmitting the same form does not duplicate the lead'; else fail := fail + 1; out := out || E'\nFAIL API idempotency'; end if;
  begin
    v_res := public.api_submit_lead('kf_live_' || repeat('0', 48), '{"first_name":"X","email":"x@example.test"}');
    fail := fail + 1; out := out || E'\nFAIL API: bad key accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS API: unknown keys are rejected';
  end;
  v_res := public.api_order_status(v_key, 'KAL-ORD-1001');
  if (v_res ->> 'status') = 'fulfilled' and (v_res ->> 'tracking_stage') = 'In transit to Beitbridge' then pass := pass + 1; out := out || E'\nPASS API: tracker can look up the order by Kalali''s own reference';
  else fail := fail + 1; out := out || E'\nFAIL order lookup ' || v_res::text; end if;
  begin
    select count(*) into v_count from public.sales_docs;
    fail := fail + 1; out := out || E'\nFAIL anon read sales docs';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: anonymous callers cannot read tables directly';
  end;
  v_text := public.shared_sales_doc('not-a-real-token-but-long-enough-000000')::text;
  if v_text is null then pass := pass + 1; out := out || E'\nPASS sharing: wrong link returns nothing'; else fail := fail + 1; out := out || E'\nFAIL share leak'; end if;
  execute 'reset role';
  select consent_basis::text into v_text from public.crm_leads where company_id = ca and external_ref = 'form-77';
  if v_text = 'consent' then pass := pass + 1; out := out || E'\nPASS API: POPIA consent from the form is recorded'; else fail := fail + 1; out := out || E'\nFAIL consent ' || coalesce(v_text, 'null'); end if;

  -- ===== sales member S =====
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.record_customer_payment(v_cust2, 100, v_bank);
    fail := fail + 1; out := out || E'\nFAIL roles: sales recorded a payment';
  exception when others then pass := pass + 1; out := out || E'\nPASS roles: sales cannot record payments';
  end;
  begin
    perform public.add_unit_cost(v_unit, 'other', 1, v_bank);
    fail := fail + 1; out := out || E'\nFAIL roles: sales added a cost';
  exception when others then pass := pass + 1; out := out || E'\nPASS roles: sales cannot post landed costs';
  end;
  select count(*) into v_count from public.api_keys where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS roles: sales cannot see API keys'; else fail := fail + 1; out := out || E'\nFAIL roles: sales sees keys'; end if;
  execute 'reset role';

  -- ===== other company B =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  cb := public.create_company('Other Co B');
  select count(*) into v_count from public.sales_docs where company_id = ca;
  if v_count = 0 then pass := pass + 1; out := out || E'\nPASS isolation: B sees none of A''s documents'; else fail := fail + 1; out := out || E'\nFAIL isolation docs'; end if;
  begin
    perform public.convert_sales_doc(v_inv2, 'credit_note');
    fail := fail + 1; out := out || E'\nFAIL isolation: B credited A''s invoice';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot touch A''s invoices';
  end;
  begin
    perform public.record_customer_payment(v_cust, 1, v_bank);
    fail := fail + 1; out := out || E'\nFAIL isolation: B posted a payment to A';
  exception when others then pass := pass + 1; out := out || E'\nPASS isolation: B cannot post payments to A''s customers';
  end;
  execute 'reset role';

  raise exception 'KAGEFLOW SALES TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
