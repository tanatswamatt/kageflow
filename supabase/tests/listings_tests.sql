-- Kageflow listings and lead capture tests. Rolled back at the end; the report is the final error message.
do $test$
declare
  a uuid := gen_random_uuid(); s uuid := gen_random_uuid(); vw uuid := gen_random_uuid();
  ca uuid; v_vehicle uuid; v_unit uuid; v_unit2 uuid; v_feed text; v_mail text; v_wa text; v_secret text := 'test-app-secret';
  v_res jsonb; v_raw text; v_sig text; v_n int; v_lead uuid; v_lead2 uuid; v_txt text;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lst-a@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lst-s@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (vw, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lst-v@kageflow.test', '', now(), '{}', '{}', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Lot A');
  perform public.add_member_by_email(ca, 'lst-s@kageflow.test', 'sales');
  perform public.add_member_by_email(ca, 'lst-v@kageflow.test', 'viewer');
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, list_price, mileage_km)
  values (ca, v_vehicle, 'AHTFR22G106099999', 'Toyota', 'Hilux', 2021, 389900, 65000) returning id into v_unit;
  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, list_price)
  values (ca, v_vehicle, 'WVWZZZ6RZEY123456', 'VW', 'Polo', 2019, 189900) returning id into v_unit2;
  select stock_no into v_txt from public.inventory_units where id = v_unit;
  if v_txt = 'STK-000001' then pass := pass + 1; out := out || E'\nPASS stock numbers: first vehicle is STK-000001';
  else fail := fail + 1; out := out || E'\nFAIL stock no ' || coalesce(v_txt, 'null'); end if;

  update public.inventory_units set is_published = true, advert_price = 379900, features = array['Tow bar', 'Canopy'] where id in (v_unit, v_unit2);
  insert into public.vehicle_photos (company_id, unit_id, url, position) values (ca, v_unit, 'https://x.test/1.jpg', 0), (ca, v_unit, 'https://x.test/2.jpg', 1);
  select image_url into v_txt from public.inventory_units where id = v_unit;
  if v_txt = 'https://x.test/1.jpg' then pass := pass + 1; out := out || E'\nPASS photos: first photo becomes the main picture';
  else fail := fail + 1; out := out || E'\nFAIL main photo ' || coalesce(v_txt, 'null'); end if;
  insert into public.listing_feeds (company_id, channel, name, include_reserved) values (ca, 'autotrader', 'AutoTrader', false) returning token into v_feed;
  update public.inventory_units set status = 'reserved' where id = v_unit2;
  execute 'reset role';

  -- the outside world (anon)
  execute 'set local role anon';
  v_res := public.stock_feed(v_feed);
  if (v_res ->> 'count')::int = 1 and v_res -> 'vehicles' -> 0 ->> 'stock_no' = 'STK-000001' and (v_res -> 'vehicles' -> 0 ->> 'price')::numeric = 379900
     and jsonb_array_length(v_res -> 'vehicles' -> 0 -> 'photos') = 2 and v_res -> 'vehicles' -> 0 ? 'landed_cost' = false then
    pass := pass + 1; out := out || E'\nPASS feed: published, available vehicle with advert price and 2 photos; reserved one left out';
  else fail := fail + 1; out := out || E'\nFAIL feed ' || coalesce(v_res::text, 'null'); end if;
  if public.stock_feed('0000000000000000000000000000000000000000') is null then pass := pass + 1; out := out || E'\nPASS feed: wrong token returns nothing';
  else fail := fail + 1; out := out || E'\nFAIL feed wrong token'; end if;
  begin
    select count(*) into v_n from public.listing_feeds;
    fail := fail + 1; out := out || E'\nFAIL anon read feeds table';
  exception when others then pass := pass + 1; out := out || E'\nPASS anon cannot read feed tokens';
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.inventory_units set status = 'written_off' where id = v_unit2;
  select is_published::text into v_txt from public.inventory_units where id = v_unit2;
  if v_txt = 'false' then pass := pass + 1; out := out || E'\nPASS written off vehicles drop off the feeds automatically';
  else fail := fail + 1; out := out || E'\nFAIL unpublish'; end if;
  insert into public.lead_channels (company_id, kind, name) values (ca, 'email', 'Portal leads') returning token into v_mail;
  insert into public.lead_channels (company_id, kind, name, phone_number_id, display_phone, app_secret, access_token)
  values (ca, 'whatsapp', 'WhatsApp', 'PNID1', '+27 82 000 0000', v_secret, 'EAAtest') returning token into v_wa;
  execute 'reset role';

  execute 'set local role anon';
  v_res := public.inbound_email_lead(v_mail, jsonb_build_object('source', 'autotrader', 'source_detail', 'AutoTrader',
    'first_name', 'Sipho', 'last_name', 'Dlamini', 'phone', '082 123 4567', 'email', 'Sipho@Example.com',
    'subject', 'New lead: 2021 Toyota Hilux', 'message', 'Is the Hilux ref STK-000001 still available?', 'message_id', '<m1@autotrader>'));
  v_lead := (v_res ->> 'lead_id')::uuid;
  if (v_res ->> 'created')::boolean and v_res ->> 'stock_no' = 'STK-000001' then pass := pass + 1; out := out || E'\nPASS email lead: AutoTrader enquiry created a lead linked to STK-000001';
  else fail := fail + 1; out := out || E'\nFAIL email lead ' || v_res::text; end if;
  v_res := public.inbound_email_lead(v_mail, jsonb_build_object('first_name', 'Sipho', 'phone', '082 123 4567', 'message', 'x', 'message_id', '<m1@autotrader>'));
  if (v_res ->> 'duplicate')::boolean then pass := pass + 1; out := out || E'\nPASS email lead: the same email delivered twice is ignored';
  else fail := fail + 1; out := out || E'\nFAIL duplicate ' || v_res::text; end if;

  -- WhatsApp from the same person, international format
  v_raw := json_build_object('object', 'whatsapp_business_account', 'entry', json_build_array(json_build_object('changes', json_build_array(json_build_object(
    'field', 'messages', 'value', json_build_object('metadata', json_build_object('phone_number_id', 'PNID1'),
      'contacts', json_build_array(json_build_object('wa_id', '27821234567', 'profile', json_build_object('name', 'Sipho D'))),
      'messages', json_build_array(json_build_object('from', '27821234567', 'id', 'wamid.1', 'type', 'text', 'text', json_build_object('body', 'Can I come see it Saturday?')))))))))::text;
  v_sig := 'sha256=' || encode(extensions.hmac(v_raw, v_secret, 'sha256'), 'hex');
  begin
    perform public.whatsapp_inbound(v_wa, v_raw, 'sha256=bad');
    fail := fail + 1; out := out || E'\nFAIL WhatsApp accepted a bad signature';
  exception when others then pass := pass + 1; out := out || E'\nPASS WhatsApp: messages without Meta''s signature are rejected';
  end;
  v_n := public.whatsapp_inbound(v_wa, v_raw, v_sig);
  v_n := v_n + public.whatsapp_inbound(v_wa, v_raw, v_sig);
  execute 'reset role';
  select lead_id into v_lead2 from public.whatsapp_messages where wa_message_id = 'wamid.1';
  if v_n = 1 and v_lead2 = v_lead then pass := pass + 1; out := out || E'\nPASS WhatsApp: message joined Sipho''s existing lead (082... = +27 82...), retry ignored';
  else fail := fail + 1; out := out || E'\nFAIL WhatsApp n=' || v_n || ' lead match ' || coalesce((v_lead2 = v_lead)::text, 'null'); end if;
  select count(*) into v_n from public.crm_leads where company_id = ca;
  if v_n = 1 then pass := pass + 1; out := out || E'\nPASS no duplicate leads: one person, one lead'; else fail := fail + 1; out := out || E'\nFAIL lead count ' || v_n; end if;
  select count(*) into v_n from public.crm_activities where lead_id = v_lead;
  if v_n = 2 then pass := pass + 1; out := out || E'\nPASS timeline: email and WhatsApp both logged on the lead'; else fail := fail + 1; out := out || E'\nFAIL activities ' || v_n; end if;

  -- replying
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.whatsapp_send_context(v_lead);
  if v_res ->> 'to' = '27821234567' and v_res ->> 'phone_number_id' = 'PNID1' then pass := pass + 1; out := out || E'\nPASS reply: sales can reply on WhatsApp to the number that messaged';
  else fail := fail + 1; out := out || E'\nFAIL send context ' || v_res::text; end if;
  perform public.whatsapp_log_outbound(v_lead, (v_res ->> 'channel_id')::uuid, '27821234567', 'Yes, Saturday 10:00 works', 'wamid.out1');
  select status::text into v_txt from public.crm_leads where id = v_lead;
  if v_txt = 'contacted' then pass := pass + 1; out := out || E'\nPASS reply marks a new lead as contacted'; else fail := fail + 1; out := out || E'\nFAIL status ' || v_txt; end if;
  begin
    select count(*) into v_n from public.lead_channels;
    if v_n = 0 then pass := pass + 1; out := out || E'\nPASS sales cannot read WhatsApp keys directly';
    else fail := fail + 1; out := out || E'\nFAIL sales read lead_channels'; end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.whatsapp_send_context(v_lead);
    fail := fail + 1; out := out || E'\nFAIL viewer got WhatsApp token';
  exception when others then pass := pass + 1; out := out || E'\nPASS viewers cannot send WhatsApp messages';
  end;
  execute 'reset role';

  raise exception 'KAGEFLOW LISTINGS TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
