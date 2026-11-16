-- Kageflow export readiness tests: deterministic checklist, document conflicts, approval and release.
-- Rolled back; the report is the final error.
do $test$
declare
  a uuid := gen_random_uuid(); s uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); vw uuid := gen_random_uuid();
  ca uuid; v_bank uuid; v_std uuid; v_vehicle uuid; v_cust uuid; v_unit uuid; v_order uuid; v_inv uuid;
  v_case uuid; v_ruleset uuid; v_title uuid; v_doc uuid; v_fin uuid; v_approval uuid; v_release uuid;
  v_res jsonb; v_total numeric; v_cnt int; v_txt text; v_txt2 text; v_kind text;
  out text := ''; pass int := 0; fail int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-owner@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (s,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-sales@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (acc,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-acc@kageflow.test', '', now(), '{}', '{}', now(), now()),
         (vw, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-viewer@kageflow.test', '', now(), '{}', '{}', now(), now());

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ca := public.create_company('Export Dealer', 'Export Dealer (Pty) Ltd', null, null);
  perform public.add_member_by_email(ca, 'export-sales@kageflow.test', 'sales');
  perform public.add_member_by_email(ca, 'export-acc@kageflow.test', 'accountant');
  perform public.add_member_by_email(ca, 'export-viewer@kageflow.test', 'viewer');

  select id into v_bank from public.accounts where company_id = ca and system_key = 'bank';
  select id into v_std from public.tax_rates where company_id = ca and code = 'STD';
  select id into v_vehicle from public.products where company_id = ca and sku = 'VEHICLE';
  select id into v_ruleset from public.export_rulesets where company_id = ca and status = 'published';
  if v_ruleset is not null then pass := pass + 1; out := out || E'\nPASS a versioned corridor checklist is seeded with the company';
  else fail := fail + 1; out := out || E'\nFAIL no checklist seeded'; end if;

  insert into public.crm_accounts (company_id, name, kind, country, city, billing_address, email)
  values (ca, 'Zimbabwe Buyer', 'customer', 'ZW', 'Harare', '12 Samora Machel Avenue', 'buyer@example.com')
  returning id into v_cust;

  insert into public.inventory_units (company_id, product_id, serial_no, make, model, year, vin_confirmed)
  values (ca, v_vehicle, 'AHTFR22G106011111', 'Toyota', 'Hilux', 2022, true)
  returning id into v_unit;

  insert into public.sales_docs (company_id, doc_type, account_id) values (ca, 'order', v_cust) returning id into v_order;
  insert into public.sales_doc_lines (company_id, doc_id, line_no, product_id, unit_id, description, unit_price, tax_rate_id)
  values (ca, v_order, 1, v_vehicle, v_unit, '2022 Toyota Hilux', 400000, v_std);
  update public.sales_docs set status = 'open' where id = v_order;

  insert into public.export_cases
    (company_id, account_id, unit_id, order_id, ruleset_id, origin_country, destination_country, route, incoterm,
     planned_departure, planned_arrival, proof_of_export_due_date, proof_of_export_owner)
  values
    (ca, v_cust, v_unit, v_order, v_ruleset, 'ZA', 'ZW', 'Beitbridge road corridor', 'DAP',
     current_date + 7, current_date + 9, current_date + 30, a)
  returning id into v_case;

  v_res := public.evaluate_export_case(v_case);
  if (v_res ->> 'status') = 'blocked' then pass := pass + 1; out := out || E'\nPASS a new case is blocked before title, customs documents and payment';
  else fail := fail + 1; out := out || E'\nFAIL new case status ' || coalesce(v_res ->> 'status', 'null'); end if;
  select count(*) into v_cnt from public.export_case_checks where case_id = v_case and result = 'missing';
  if v_cnt >= 3 then pass := pass + 1; out := out || E'\nPASS missing checks are recorded with results (3 expected)';
  else fail := fail + 1; out := out || E'\nFAIL missing checks counted ' || v_cnt; end if;

  begin
    update public.export_cases set status = 'ready_for_approval' where id = v_case;
    fail := fail + 1; out := out || E'\nFAIL a direct status update skipped the checklist';
  exception when others then pass := pass + 1; out := out || E'\nPASS ready_for_approval cannot be set by a direct client update';
  end;
  begin
    perform public.approve_export_case(v_case);
    fail := fail + 1; out := out || E'\nFAIL approval worked on a blocked case';
  exception when others then pass := pass + 1; out := out || E'\nPASS approval is refused while the case is blocked';
  end;

  -- Settle the sale through the normal invoice and payment path.
  v_inv := public.convert_sales_doc(v_order, 'invoice');
  perform public.issue_sales_doc(v_inv);
  select total into v_total from public.sales_docs where id = v_inv;
  perform public.record_customer_payment(v_cust, v_total, v_bank, 'ZAR', 1, current_date, 'eft', 'EXPORT-TEST', v_order,
    jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount', v_total)));
  v_res := public.evaluate_export_case(v_case);
  select result::text into v_txt from public.export_case_checks where case_id = v_case and rule_code = 'payment_conditions';
  if v_txt = 'pass' then pass := pass + 1; out := out || E'\nPASS a settled invoice clears the payment condition';
  else fail := fail + 1; out := out || E'\nFAIL payment condition ' || coalesce(v_txt, 'missing'); end if;

  insert into public.export_documents (company_id, case_id, doc_type, storage_path, file_name, mime_type, size_bytes)
  values (ca, v_case, 'proof_of_title', ca::text || '/' || v_case::text || '/title.pdf', 'title.pdf', 'application/pdf', 1000)
  returning id into v_title;

  -- Human confirmation of a bad extraction creates conflicts, but does not overwrite records.
  v_res := public.confirm_export_extraction(v_title, jsonb_build_object('vin', 'BBBBBBBBBBBBBBBBB', 'buyer_name', 'Wrong Buyer'), null);
  if (v_res ->> 'review_items')::int = 2 then pass := pass + 1; out := out || E'\nPASS a VIN and buyer mismatch create two review items';
  else fail := fail + 1; out := out || E'\nFAIL review items ' || (v_res ->> 'review_items'); end if;
  select serial_no into v_txt from public.inventory_units where id = v_unit;
  select name into v_txt2 from public.crm_accounts where id = v_cust;
  if v_txt = 'AHTFR22G106011111' and v_txt2 = 'Zimbabwe Buyer' then pass := pass + 1; out := out || E'\nPASS the vehicle VIN and buyer name were not overwritten';
  else fail := fail + 1; out := out || E'\nFAIL source records changed'; end if;

  begin
    perform public.review_export_document(v_title, 'accepted', null);
    fail := fail + 1; out := out || E'\nFAIL a document with open conflicts was accepted';
  exception when others then pass := pass + 1; out := out || E'\nPASS a document with open conflicts cannot be accepted';
  end;
  update public.export_review_items set status = 'resolved', resolution_note = 'Checked against the original title'
   where document_id = v_title and status = 'open';
  perform public.review_export_document(v_title, 'accepted', 'Original title checked');

  for v_kind in select unnest(array['commercial_invoice', 'road_freight_waybill', 'export_permit', 'customs_declaration', 'certificate_of_origin']) loop
    insert into public.export_documents (company_id, case_id, doc_type, storage_path, file_name, mime_type, size_bytes)
    values (ca, v_case, v_kind::public.export_document_kind, ca::text || '/' || v_case::text || '/' || v_kind || '.pdf', v_kind || '.pdf', 'application/pdf', 1000)
    returning id into v_doc;
    perform public.review_export_document(v_doc, 'accepted', 'Checked');
  end loop;
  select status::text into v_txt from public.export_cases where id = v_case;
  if v_txt = 'ready_for_approval' then pass := pass + 1; out := out || E'\nPASS accepted title, customs documents and settled payment make the case ready';
  else fail := fail + 1; out := out || E'\nFAIL ready status ' || coalesce(v_txt, 'null'); end if;

  begin
    perform public.release_export_case(v_case, 'vehicle_handover', null);
    fail := fail + 1; out := out || E'\nFAIL release worked before approval';
  exception when others then pass := pass + 1; out := out || E'\nPASS release is refused before approval';
  end;

  perform public.reject_export_case(v_case, 'Insurance certificate wording needs the broker to confirm it');
  select status::text into v_txt from public.export_cases where id = v_case;
  if v_txt = 'in_review' and exists (
    select 1 from public.export_approvals where case_id = v_case and decision = 'rejected'
  ) then
    pass := pass + 1; out := out || E'\nPASS a rejection is recorded with the checklist snapshot and returns the case to review';
  else fail := fail + 1; out := out || E'\nFAIL rejection status ' || coalesce(v_txt, 'null'); end if;
  perform public.evaluate_export_case(v_case);

  v_approval := public.approve_export_case(v_case, 'Evidence reviewed');
  select status::text into v_txt from public.export_cases where id = v_case;
  select checklist_version into v_cnt from public.export_approvals where id = v_approval;
  if v_txt = 'approved' and v_cnt = 1 then pass := pass + 1; out := out || E'\nPASS approval records the approver, checklist version and decision';
  else fail := fail + 1; out := out || E'\nFAIL approval status ' || coalesce(v_txt, 'null') || ' version ' || coalesce(v_cnt::text, 'null'); end if;
  if (select jsonb_array_length(checklist_snapshot -> 'items') from public.export_approvals where id = v_approval) = 6 then
    pass := pass + 1; out := out || E'\nPASS the approval snapshot holds all six evidence-backed checks';
  else fail := fail + 1; out := out || E'\nFAIL approval snapshot incomplete'; end if;

  begin
    update public.export_cases set status = 'released' where id = v_case;
    fail := fail + 1; out := out || E'\nFAIL a direct update released the vehicle without the release action';
  exception when others then pass := pass + 1; out := out || E'\nPASS release cannot be set by a direct client update';
  end;
  begin
    insert into public.export_documents (company_id, case_id, doc_type, storage_path, file_name)
    values (ca, v_case, 'other', ca::text || '/' || v_case::text || '/late.pdf', 'late.pdf');
    fail := fail + 1; out := out || E'\nFAIL evidence was added after approval';
  exception when others then pass := pass + 1; out := out || E'\nPASS added evidence is locked after approval';
  end;
  begin
    delete from public.export_documents where id = v_title;
    fail := fail + 1; out := out || E'\nFAIL approved evidence was deleted';
  exception when others then pass := pass + 1; out := out || E'\nPASS approved evidence cannot be deleted';
  end;

  -- Outstanding bank finance blocks release even after approval.
  insert into public.finance_applications (company_id, account_id, order_id, unit_id, first_name, last_name, status)
  values (ca, v_cust, v_order, v_unit, 'Test', 'Buyer', 'approved')
  returning id into v_fin;
  begin
    perform public.release_export_case(v_case, 'carrier_collection', null);
    fail := fail + 1; out := out || E'\nFAIL outstanding finance did not block release';
  exception when others then pass := pass + 1; out := out || E'\nPASS outstanding finance blocks release in the database function';
  end;
  update public.finance_applications set status = 'paid_out' where id = v_fin;
  v_release := public.release_export_case(v_case, 'carrier_collection', 'Collected by the carrier');
  select status::text into v_txt from public.export_cases where id = v_case;
  select tracking_stage into v_txt2 from public.sales_docs where id = v_order;
  if v_txt = 'released' and v_txt2 = 'Released for export' then pass := pass + 1; out := out || E'\nPASS release is a separate recorded action and advances the order tracker';
  else fail := fail + 1; out := out || E'\nFAIL release status ' || coalesce(v_txt, 'null') || ' tracker ' || coalesce(v_txt2, 'null'); end if;
  if exists (select 1 from public.export_releases where id = v_release and approval_id = v_approval) then
    pass := pass + 1; out := out || E'\nPASS the release points at the recorded approval';
  else fail := fail + 1; out := out || E'\nFAIL release is not linked to approval'; end if;

  -- Read permission: viewers see the case but not the personal documents.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.export_documents where case_id = v_case;
  if v_cnt = 0 then pass := pass + 1; out := out || E'\nPASS viewers cannot read export documents';
  else fail := fail + 1; out := out || E'\nFAIL viewer read ' || v_cnt || ' documents'; end if;
  select count(*) into v_cnt from public.export_cases where id = v_case;
  if v_cnt = 1 then pass := pass + 1; out := out || E'\nPASS viewers can read the case status and checklist';
  else fail := fail + 1; out := out || E'\nFAIL viewer read ' || v_cnt || ' cases'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.export_documents where case_id = v_case;
  if v_cnt = 6 then pass := pass + 1; out := out || E'\nPASS sales staff can read the six export documents';
  else fail := fail + 1; out := out || E'\nFAIL sales read ' || v_cnt || ' documents'; end if;
  begin
    perform public.approve_export_case(v_case);
    fail := fail + 1; out := out || E'\nFAIL sales staff approved an export';
  exception when others then pass := pass + 1; out := out || E'\nPASS sales staff cannot approve an export';
  end;

  execute 'reset role';
  raise exception 'KAGEFLOW EXPORT TEST REPORT: % passed, % failed%', pass, fail, out;
end
$test$;
