-- Country rules: run in the SQL editor; it reports RESULT and rolls back.
do $t$
declare
  u uuid := gen_random_uuid(); zw uuid; za uuid; out text := ''; a uuid; ti uuid; res jsonb; j record; v jsonb;
begin
  insert into auth.users (id, email, aud, role) values (u, 'country-test-'||u||'@example.com', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  zw := public.create_company('ZW Test Motors', null, null, '10012345', 'ZW', null);
  za := public.create_company('ZA Test Motors', null, null, '4123456789');
  out := out || E'\nZW: ' || (select country||' '||base_currency from public.companies where id=zw)
             || ' STD=' || (select rate||' '||name from public.tax_rates where company_id=zw and code='STD')
             || ' 2400=' || (select name from public.accounts where company_id=zw and code='2400');
  out := out || E'\nZA: ' || (select country||' '||base_currency from public.companies where id=za)
             || ' STD=' || (select rate::text from public.tax_rates where company_id=za and code='STD');
  begin perform public.create_company('X', null, null, null, 'ZW', 'ZAR'); out := out || E'\nFAIL ZW+ZAR allowed';
  exception when others then out := out || E'\nOK ZW+ZAR refused'; end;
  begin perform public.create_company('X', null, null, null, 'BW'); out := out || E'\nFAIL BW allowed';
  exception when others then out := out || E'\nOK BW refused'; end;
  begin update public.companies set country = 'ZA' where id = zw; out := out || E'\nFAIL country changed';
  exception when others then out := out || E'\nOK country locked'; end;
  begin update public.companies set base_currency = 'ZWG' where id = zw; out := out || E'\nFAIL currency changed';
  exception when others then out := out || E'\nOK currency locked'; end;
  insert into public.crm_accounts (company_id, name, kind) values (zw, 'Private Seller', 'customer') returning id into a;
  insert into public.trade_ins (company_id, account_id, allowance, make, seller_is_vendor) values (zw, a, 10000, 'Toyota', false) returning id into ti;
  res := public.accept_trade_in(ti, current_date);
  select currency into j from public.journals where id = (select journal_id from public.trade_ins where id = ti);
  out := out || E'\nZW private trade-in VAT (expect 0): ' || (res->>'vat_claimed') || ', journal in ' || j.currency;
  insert into public.trade_ins (company_id, account_id, allowance, make, seller_is_vendor) values (zw, a, 11550, 'Nissan', true) returning id into ti;
  out := out || E'\nZW vendor trade-in VAT (expect 1550): ' || (public.accept_trade_in(ti, current_date)->>'vat_claimed');
  insert into public.crm_accounts (company_id, name, kind) values (za, 'Private Seller', 'customer') returning id into a;
  insert into public.trade_ins (company_id, account_id, allowance, make, seller_is_vendor) values (za, a, 11500, 'VW', false) returning id into ti;
  out := out || E'\nZA private trade-in VAT (expect 1500): ' || (public.accept_trade_in(ti, current_date)->>'vat_claimed');
  raise exception 'RESULT%', out;
end $t$;
