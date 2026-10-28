-- Kageflow security review access matrix (KF-SR-2026-10).
-- Run in the Supabase SQL editor. It creates test users and a second dealership inside one
-- transaction, checks what each of them can reach, then rolls everything back by raising RESULT.
-- Expected: OUTSIDER LEAKS null, FINANCE VISIBLE TO SALES/VIEWER null, ANON SEES null,
-- "truncate refused" and "unsigned refused".
do $$
declare
  ca uuid := (select id from public.companies order by created_at limit 1);
  ub uuid := gen_random_uuid(); us uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ua uuid := gen_random_uuid();
  cb uuid; t record; n bigint; leaks text := ''; fin text := ''; acc text := ''; anon_res text := ''; wa text; tr text;
  ftab text[] := array['unit_costs','journals','journal_lines','purchase_bills','purchase_bill_lines','supplier_payments','supplier_payment_allocations','vat_returns','bank_statement_lines','audit_log','api_keys','lead_channels','listing_feeds'];
  ft text; v_tok text := encode(extensions.gen_random_bytes(24),'hex');
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
  select x, '00000000-0000-0000-0000-000000000000','authenticated','authenticated', 'sec-'||x||'@test.invalid','x',now(),now(),'{}','{}',now() from unnest(array[ub,us,uv,ua]) x;
  insert into public.companies (name, created_by) values ('Security Test B', ub) returning id into cb;
  insert into public.company_members values (cb, ub, 'owner', now()), (ca, us, 'sales', now()), (ca, uv, 'viewer', now()), (ca, ua, 'accountant', now());

  -- outsider: owner of dealership B looks at dealership A
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  set local role authenticated;
  for t in select c.table_name from information_schema.columns c join information_schema.tables tb on tb.table_name=c.table_name and tb.table_schema='public'
           where c.table_schema='public' and c.column_name='company_id' loop
    begin
      execute format('select count(*) from public.%I where company_id = $1', t.table_name) into n using ca;
      if n > 0 then leaks := leaks || t.table_name || '=' || n || ' '; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  begin execute 'update public.inventory_units set make = make where company_id = $1' using ca; get diagnostics n = row_count; if n>0 then leaks := leaks||'UPDATE units='||n||' '; end if; exception when others then null; end;
  begin execute 'update public.companies set name = name where id = $1' using ca; get diagnostics n = row_count; if n>0 then leaks := leaks||'UPDATE company='||n||' '; end if; exception when others then null; end;
  begin truncate public.vehicle_photos; tr := 'TRUNCATE ALLOWED'; exception when insufficient_privilege then tr := 'truncate refused'; end;
  reset role;

  -- inside dealership A: sales and viewer must not see finance tables, accountant must
  foreach ft in array ftab loop
    perform set_config('request.jwt.claims', json_build_object('sub', us, 'role','authenticated')::text, true);
    set local role authenticated; execute format('select count(*) from public.%I where company_id = $1', ft) into n using ca; reset role;
    if n > 0 then fin := fin || 'sales:' || ft || '=' || n || ' '; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role','authenticated')::text, true);
    set local role authenticated; execute format('select count(*) from public.%I where company_id = $1', ft) into n using ca; reset role;
    if n > 0 then fin := fin || 'viewer:' || ft || '=' || n || ' '; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
    set local role authenticated; execute format('select count(*) from public.%I where company_id = $1', ft) into n using ca; reset role;
    acc := acc || ft || '=' || n || ' ';
  end loop;

  -- signed-out visitor
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  for t in select c.table_name from information_schema.columns c join information_schema.tables tb on tb.table_name=c.table_name and tb.table_schema='public'
           where c.table_schema='public' and c.column_name='company_id' loop
    begin execute format('select count(*) from public.%I', t.table_name) into n; if n > 0 then anon_res := anon_res || t.table_name || '=' || n || ' '; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  reset role;

  -- WhatsApp channel without an app secret must refuse messages
  insert into public.lead_channels (company_id, kind, name, token, is_active) values (ca, 'whatsapp', 'sec test', v_tok, true);
  begin perform public.whatsapp_inbound(v_tok, '{"entry":[]}', ''); wa := 'UNSIGNED ACCEPTED'; exception when others then wa := 'unsigned refused: ' || sqlerrm; end;

  raise exception E'RESULT\nOUTSIDER LEAKS: %\nFINANCE VISIBLE TO SALES/VIEWER: %\nACCOUNTANT SEES: %\nANON SEES: %\n%\n%', nullif(leaks,''), nullif(fin,''), acc, nullif(anon_res,''), tr, wa;
end $$;
