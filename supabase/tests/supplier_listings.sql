-- Supplier listings and shared floor plans: run in the SQL editor; it reports RESULT and rolls back.
do $t$
declare ub uuid := gen_random_uuid(); us uuid := gen_random_uuid();
  kb uuid; ks uuid; sup uuid; lu uuid; su uuid; sh uuid; bu uuid; out text := ''; v_code text; prod uuid;
begin
  insert into auth.users (id, email, aud, role) values (ub, 'b-'||ub||'@x.com','authenticated','authenticated'), (us, 's-'||us||'@x.com','authenticated','authenticated');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  ks := public.create_company('Floor Supplier', null, null, '4333333333');
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  kb := public.create_company('Broker Exports', null, null, '4444444444');
  insert into public.crm_accounts (company_id, name, kind) values (kb, 'Joe''s Cars', 'supplier') returning id into sup;
  begin insert into public.inventory_units (company_id, serial_no, make, status, supplier_account_id) values (kb, 'TBC-AAAA1', 'Toyota', 'listed', sup);
    out := out || E'\nFAIL unapproved listed'; exception when others then out := out || E'\nOK unapproved refused'; end;
  update public.crm_accounts set approved_supplier = true where id = sup;
  insert into public.inventory_units (company_id, serial_no, make, model, status, supplier_account_id, supplier_price)
    values (kb, 'TBC-AAAA1', 'Toyota', 'Hilux', 'listed', sup, 300000) returning id into lu;
  begin perform public.buy_listed_vehicle(lu, 260869.57, 39130.43); out := out || E'\nFAIL bought uninspected'; exception when others then out := out || E'\nOK buy needs inspection'; end;
  perform public.inspect_vehicle(lu, 'AHTFR22G406012345');
  perform public.buy_listed_vehicle(lu, 260869.57, 39130.43);
  out := out || E'\nbought: ' || (select status from public.inventory_units where id = lu) || ', bill ' || (select number || ' ' || amount_due from public.purchase_bills where company_id = kb);
  reset role; v_code := (select dealer_code from public.companies where id = kb); set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  select id into prod from public.products p where p.company_id = ks and p.sku = 'VEHICLE';
  insert into public.inventory_units (company_id, product_id, serial_no, vin_confirmed, make, model, mileage_km, status)
    values (ks, prod, 'WDD2050042R123456', true, 'Mercedes-Benz', 'C200', 90000, 'in_stock') returning id into su;
  perform public.share_vehicle(su, v_code, 250000);
  select id into sh from public.stock_shares where unit_id = su;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  bu := public.accept_share(sh, 289900, true);
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  update public.inventory_units set mileage_km = 91500 where id = su;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  out := out || E'\nsynced mileage: ' || (select mileage_km from public.inventory_units where id = bu) || ' (expect 91500)';
  perform public.buy_listed_vehicle(bu, 250000);
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  out := out || E'\nsupplier car: ' || (select status from public.inventory_units where id = su) || ' (expect reserved)';
  raise exception 'RESULT%', out;
end $t$;
