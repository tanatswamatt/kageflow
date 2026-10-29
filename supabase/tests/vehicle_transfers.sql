-- Car handover between dealerships: run in the SQL editor; it reports RESULT and rolls back.
do $t$
declare ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  ca uuid; cb uuid; cc uuid; acc uuid; unit uuid; doc uuid; tr uuid; res jsonb; out text := ''; v_code text; std uuid; prod uuid;
begin
  insert into auth.users (id, email, aud, role) values (ua, 'a-'||ua||'@x.com','authenticated','authenticated'), (ub, 'b-'||ub||'@x.com','authenticated','authenticated'), (uc, 'c-'||uc||'@x.com','authenticated','authenticated');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  cb := public.create_company('Buyer Motors', null, null, '4999999999');
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  cc := public.create_company('Snoop Motors');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ca := public.create_company('Seller Motors', null, null, '4111111111');
  reset role; v_code := (select dealer_code from public.companies where id = cb); set local role authenticated;
  insert into public.crm_accounts (company_id, name, kind, billing_address) values (ca, 'Buyer Motors', 'customer', '1 Main Rd') returning id into acc;
  out := out || E'\nlinked to ' || public.link_account_dealer(acc, v_code);
  select id into prod from public.products p where p.company_id = ca and p.sku='VEHICLE';
  select id into std from public.tax_rates r where r.company_id = ca and r.code='STD';
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, mileage_km, is_second_hand)
    values (ca, prod, 'WVWZZZ6RZEY123456', 'Volkswagen', 'Polo Vivo', 2019, 81000, true) returning id into unit;
  perform public.add_unit_cost(unit, 'purchase', 100000, (select id from public.accounts a where a.company_id=ca and a.system_key='bank'));
  insert into public.sales_docs (company_id, doc_type, account_id, issue_date, currency, fx_rate) values (ca, 'invoice', acc, current_date, 'ZAR', 1) returning id into doc;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, quantity, unit_price, tax_rate_id) values (ca, doc, 1, prod, unit, 'Polo', 1, 120000, std);
  perform public.issue_sales_doc(doc);
  out := out || E'\nsent=' || public.send_vehicle_transfers(doc) || ' again=' || public.send_vehicle_transfers(doc);
  select id into tr from public.vehicle_transfers where invoice_id = doc;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  out := out || E'\nothers see ' || (select count(*) from public.vehicle_transfers) || ' (expect 0)';
  begin perform public.accept_vehicle_transfer(tr); out := out || E'\nFAIL other dealer accepted'; exception when others then out := out || E'\nOK other dealer refused'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  res := public.accept_vehicle_transfer(tr, 'Main yard');
  out := out || E'\naccepted: ' || (select serial_no||' '||make||' '||model||' '||list_currency from public.inventory_units where id = (res->>'unit_id')::uuid);
  out := out || E'\nbuyer sees seller costs: ' || (select count(*) from public.unit_costs where company_id = ca) || ' (expect 0)';
  begin perform public.accept_vehicle_transfer(tr); out := out || E'\nFAIL accepted twice'; exception when others then out := out || E'\nOK twice refused'; end;
  raise exception 'RESULT%', out;
end $t$;
