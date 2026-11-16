-- Keep rejected copies visible to the deterministic readiness decision and add a
-- supported owner/admin editing path for draft checklist versions.

create or replace function private.export_rejected_required_documents(p_case uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct d.file_name order by d.file_name), '{}'::text[])
    from public.export_cases c
    join public.export_ruleset_items i on i.ruleset_id = c.ruleset_id and i.code = 'customs_documents'
    cross join lateral jsonb_array_elements(coalesce(
      nullif(i.params -> 'document_groups', '[]'::jsonb),
      '[["commercial_invoice"],["road_freight_waybill","bill_of_lading"],["export_permit"],["customs_declaration"]]'::jsonb
    )) grp
    cross join lateral jsonb_array_elements_text(grp) required(kind)
    join public.export_documents d on d.case_id = c.id
      and d.doc_type::text = required.kind and d.review_status = 'rejected'
   where c.id = p_case;
$$;

create or replace function private.export_refresh_checks(p_case uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.export_cases;
  i public.export_ruleset_items;
  chk record;
  v_checks jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_failed int := 0;
  v_review int := 0;
  v_open int := 0;
  v_rejected text[];
begin
  select * into c from public.export_cases where id = p_case;
  if c.id is null then raise exception 'Export case not found'; end if;

  for i in select * from public.export_ruleset_items where ruleset_id = c.ruleset_id order by position loop
    select * into chk from private.export_check(c.id, i.code);
    insert into public.export_case_checks
      (company_id, case_id, ruleset_item_id, rule_code, rule_title, blocking, result, evidence, note, checked_by, checked_at)
    values
      (c.company_id, c.id, i.id, i.code, i.title, i.blocking, chk.result, coalesce(chk.evidence, '{}'::jsonb), chk.note, auth.uid(), now())
    on conflict (case_id, ruleset_item_id) do update
      set rule_code = excluded.rule_code,
          rule_title = excluded.rule_title,
          blocking = excluded.blocking,
          result = excluded.result,
          evidence = excluded.evidence,
          note = excluded.note,
          checked_by = excluded.checked_by,
          checked_at = excluded.checked_at;
  end loop;

  v_rejected := private.export_rejected_required_documents(c.id);
  if cardinality(v_rejected) > 0 then
    update public.export_case_checks ch
       set result = 'failed',
           evidence = ch.evidence || jsonb_build_object('rejected_required_documents', to_jsonb(v_rejected)),
           note = concat_ws('; ', nullif(ch.note, ''), 'Rejected required document(s): ' || array_to_string(v_rejected, ', ')),
           checked_by = auth.uid(), checked_at = now()
      from public.export_ruleset_items i
     where ch.case_id = c.id and ch.ruleset_item_id = i.id and i.code = 'customs_documents';
  end if;

  select count(*) filter (where ch.blocking and ch.result in ('missing', 'failed')),
         count(*) filter (where ch.blocking and ch.result = 'needs_review')
    into v_failed, v_review
    from public.export_case_checks ch where ch.case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', ch.rule_code, 'title', ch.rule_title, 'blocking', ch.blocking,
           'result', ch.result, 'note', ch.note, 'evidence', ch.evidence
         ) order by i.position), '[]'::jsonb)
    into v_checks
    from public.export_case_checks ch
    join public.export_ruleset_items i on i.id = ch.ruleset_item_id
   where ch.case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', ch.rule_code, 'title', ch.rule_title, 'result', ch.result, 'note', ch.note
         ) order by i.position), '[]'::jsonb)
    into v_blockers
    from public.export_case_checks ch
    join public.export_ruleset_items i on i.id = ch.ruleset_item_id
   where ch.case_id = c.id and ch.result <> 'pass';

  select count(*) into v_open from public.export_review_items r
   where r.case_id = c.id and r.status = 'open' and r.severity = 'blocking';

  return jsonb_build_object('checks', v_checks, 'blockers', v_blockers, 'failed', v_failed,
                            'needs_review', v_review, 'open_reviews', v_open);
end $$;

create function public.update_export_ruleset_item(
  p_item uuid, p_title text, p_description text, p_blocking boolean, p_evidence_hint text, p_params jsonb default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.export_ruleset_items;
  r public.export_rulesets;
begin
  select * into i from public.export_ruleset_items where id = p_item for update;
  if i.id is null then raise exception 'Checklist item not found'; end if;
  select * into r from public.export_rulesets where id = i.ruleset_id for update;
  if not private.has_role(i.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can edit export checklists';
  end if;
  if r.status <> 'draft' then raise exception 'Only a draft checklist can be edited'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A checklist item needs a title'; end if;
  if p_blocking is null then raise exception 'Choose whether this item blocks readiness'; end if;
  if p_params is not null then
    if i.code <> 'customs_documents' or jsonb_typeof(p_params) is distinct from 'object' then
      raise exception 'Only required document groups can be configured here';
    end if;
    if jsonb_typeof(p_params -> 'document_groups') is distinct from 'array' then
      raise exception 'Required document groups must be a JSON array';
    end if;
    if jsonb_array_length(p_params -> 'document_groups') = 0 then
      raise exception 'Add at least one required document group';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_params -> 'document_groups') grp
        where jsonb_typeof(grp) <> 'array'
           or jsonb_array_length(case when jsonb_typeof(grp) = 'array' then grp else '[]'::jsonb end) = 0
           or exists (
             select 1 from jsonb_array_elements_text(case when jsonb_typeof(grp) = 'array' then grp else '[]'::jsonb end) as kinds(kind)
              where kind not in ('commercial_invoice', 'road_freight_waybill', 'bill_of_lading', 'export_permit', 'customs_declaration', 'certificate_of_origin')
           )
    ) then raise exception 'Choose valid export document types for each required group'; end if;
  end if;
  update public.export_ruleset_items
     set title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), ''),
         blocking = p_blocking, evidence_hint = nullif(trim(coalesce(p_evidence_hint, '')), ''),
         params = coalesce(p_params, i.params)
   where id = i.id;
end $$;

create function public.update_export_ruleset_metadata(
  p_ruleset uuid, p_title text, p_source_title text, p_source_url text, p_notes text
)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.export_rulesets;
begin
  select * into r from public.export_rulesets where id = p_ruleset for update;
  if r.id is null then raise exception 'Checklist not found'; end if;
  if not private.has_role(r.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can edit export checklists';
  end if;
  if r.status <> 'draft' then raise exception 'Only a draft checklist can be edited'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null or nullif(trim(coalesce(p_source_title, '')), '') is null then
    raise exception 'Checklist title and source are required';
  end if;
  if nullif(trim(coalesce(p_source_url, '')), '') is not null and trim(p_source_url) !~ '^https://'
    then raise exception 'Checklist source links must use HTTPS'; end if;
  update public.export_rulesets
     set title = trim(p_title), source_title = trim(p_source_title),
         source_url = nullif(trim(coalesce(p_source_url, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = r.id;
end $$;

revoke all on function private.export_rejected_required_documents(uuid) from public, anon, authenticated;
revoke all on function public.update_export_ruleset_item(uuid, text, text, boolean, text, jsonb) from public, anon;
revoke all on function public.update_export_ruleset_metadata(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_export_ruleset_item(uuid, text, text, boolean, text, jsonb) to authenticated;
grant execute on function public.update_export_ruleset_metadata(uuid, text, text, text, text) to authenticated;
