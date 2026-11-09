-- Website and API leads go through the same capture as WhatsApp and email leads:
-- the same person within 90 days joins their open lead instead of making a duplicate,
-- and a stock number (stock_no, or STK-… in the text) or VIN links the lead to the car.
create or replace function public.api_submit_lead(p_api_key text, p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.api_company(p_api_key);
  v_ref text := nullif(trim(p_lead ->> 'external_ref'), '');
  v_source public.crm_lead_source;
  v_consent boolean := false;
  v_value numeric;
  v_stock text := nullif(trim(p_lead ->> 'stock_no'), '');
  v_interest text := nullif(trim(p_lead ->> 'interest'), '');
  v_message text := nullif(trim(p_lead ->> 'message'), '');
  v_res jsonb;
  v_id uuid;
begin
  if jsonb_typeof(p_lead) <> 'object' then
    raise exception 'Lead must be a JSON object' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_lead ->> 'first_name'), ''), nullif(trim(p_lead ->> 'last_name'), ''), nullif(trim(p_lead ->> 'company_name'), '')) is null then
    raise exception 'Send first_name, last_name or company_name' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_lead ->> 'email'), ''), nullif(trim(p_lead ->> 'phone'), '')) is null then
    raise exception 'Send an email or phone number' using errcode = '22023';
  end if;
  begin v_consent := coalesce((p_lead ->> 'consent')::boolean, false); exception when others then v_consent := false; end;
  begin
    v_source := coalesce(nullif(p_lead ->> 'source', ''), 'web_form')::public.crm_lead_source;
  exception when others then
    v_source := 'web_form';
  end;
  begin
    v_value := nullif(p_lead ->> 'estimated_value', '')::numeric;
  exception when others then
    v_value := null;
  end;

  v_res := private.capture_lead(v_company, v_source, left(coalesce(nullif(trim(p_lead ->> 'source_detail'), ''), 'Website'), 200),
             nullif(trim(p_lead ->> 'first_name'), ''), nullif(trim(p_lead ->> 'last_name'), ''),
             nullif(trim(p_lead ->> 'email'), ''), nullif(trim(p_lead ->> 'phone'), ''),
             left(coalesce(nullif(trim(p_lead ->> 'subject'), ''), 'Website enquiry') || coalesce(' about ' || v_stock, ''), 300),
             concat_ws(E'\n', v_interest, v_message), 'note', v_ref, true);
  v_id := (v_res ->> 'lead_id')::uuid;

  if coalesce((v_res ->> 'duplicate')::boolean, false) then
    return jsonb_build_object('id', v_id, 'status', 'existing');
  end if;

  update public.crm_leads
     set company_name = coalesce(company_name, left(nullif(trim(p_lead ->> 'company_name'), ''), 200)),
         interest = coalesce(interest, left(v_interest, 500)),
         estimated_value = coalesce(estimated_value, case when v_value >= 0 then v_value end),
         currency = case when (v_res ->> 'created')::boolean and coalesce(p_lead ->> 'currency', '') ~ '^[A-Z]{3}$' and unit_id is null then p_lead ->> 'currency' else currency end,
         external_ref = coalesce(external_ref, v_ref),
         consent_basis = case when v_consent and consent_basis = 'not_recorded' then 'consent'::public.consent_basis else consent_basis end,
         consent_source = case when v_consent and consent_basis = 'not_recorded' then left(coalesce(nullif(trim(p_lead ->> 'consent_text'), ''), 'Website form'), 300) else consent_source end,
         consent_at = case when v_consent and consent_basis = 'not_recorded' then now() else consent_at end
   where id = v_id;

  return jsonb_build_object('id', v_id, 'status', case when (v_res ->> 'created')::boolean then 'created' else 'existing' end,
                            'stock_no', v_res ->> 'stock_no');
end $$;
