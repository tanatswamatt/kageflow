-- Kageflow 0031: export readiness
--
-- One export case ties an existing buyer, vehicle and sales order together. Readiness is a
-- deterministic, versioned checklist for one outbound corridor:
--   * the checklist is a published ruleset with items, a source and an effective date
--   * every evaluation records the result, evidence, who checked it and when
--   * a blocking item that is missing, failed or needs review keeps the case out of
--     ready_for_approval, and database triggers enforce the same rule for approval and release
--   * documents are attached and reviewed by a person; extracted values are proposals only
--   * approval and release are separate, recorded actions. Outstanding finance or missing
--     proof of title blocks both in SQL, not only in the UI.
--
-- The first corridor is the home country -> the other Kageflow country (ZA -> ZW or ZW -> ZA).
-- Rule handlers are deliberately limited to the six checks below; adding a corridor means
-- publishing a new ruleset version, not adding country law to the UI.

create type public.export_case_status as enum ('draft', 'in_review', 'blocked', 'ready_for_approval', 'approved', 'released', 'cancelled');
create type public.export_check_result as enum ('pass', 'missing', 'failed', 'needs_review');
create type public.export_document_kind as enum (
  'commercial_invoice', 'bill_of_lading', 'road_freight_waybill', 'export_permit',
  'customs_declaration', 'certificate_of_origin', 'proof_of_title', 'proof_of_export',
  'payment_proof', 'other'
);
create type public.export_document_status as enum ('uploaded', 'in_review', 'accepted', 'rejected');
create type public.export_incoterm as enum ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');

-- ---------- versioned corridor rulesets ----------
create table public.export_rulesets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  corridor_code text not null check (corridor_code ~ '^[A-Z]{2}-[A-Z]{2}$'),
  origin_country char(2) not null check (origin_country ~ '^[A-Z]{2}$'),
  destination_country char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  title text not null check (length(trim(title)) > 0),
  source_title text not null check (length(trim(source_title)) > 0),
  source_url text,
  effective_from date not null,
  notes text,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin_country <> destination_country),
  unique (company_id, id),
  unique (company_id, corridor_code, version)
);
create unique index export_rulesets_one_published_idx on public.export_rulesets (company_id, corridor_code)
  where status = 'published';
create trigger export_rulesets_touch before update on public.export_rulesets
  for each row execute function private.touch_updated_at();

create table public.export_ruleset_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ruleset_id uuid not null,
  code text not null check (code ~ '^[a-z_]+$'),
  title text not null check (length(trim(title)) > 0),
  description text,
  category text not null check (category in ('party', 'vehicle', 'finance_title', 'documents', 'payment', 'evidence')),
  blocking boolean not null default true,
  evidence_hint text,
  params jsonb not null default '{}'::jsonb,
  position int not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (ruleset_id, code),
  foreign key (company_id, ruleset_id) references public.export_rulesets (company_id, id) on delete cascade
);
create index export_ruleset_items_ruleset_idx on public.export_ruleset_items (ruleset_id, position);

-- ---------- the case ----------
create table public.export_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  case_no text,
  status public.export_case_status not null default 'draft',
  account_id uuid not null,
  contact_id uuid,
  unit_id uuid not null,
  order_id uuid not null,
  ruleset_id uuid not null,
  origin_country char(2) not null check (origin_country ~ '^[A-Z]{2}$'),
  destination_country char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  route text not null check (length(trim(route)) > 0),
  incoterm public.export_incoterm not null,
  incoterm_place text,
  planned_departure date,
  planned_arrival date,
  destination_requirements text,
  notes text,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  proof_of_export_due_date date,
  proof_of_export_owner uuid references auth.users (id) on delete set null,
  last_evaluated_at timestamptz,
  last_evaluated_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin_country <> destination_country),
  check (planned_arrival is null or planned_departure is null or planned_arrival >= planned_departure),
  unique (company_id, id),
  unique (company_id, case_no),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id),
  foreign key (company_id, contact_id) references public.crm_contacts (company_id, id) on delete set null (contact_id),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id),
  foreign key (company_id, order_id) references public.sales_docs (company_id, id),
  foreign key (company_id, ruleset_id) references public.export_rulesets (company_id, id)
);
create index export_cases_company_status_idx on public.export_cases (company_id, status, created_at desc);
create index export_cases_account_idx on public.export_cases (company_id, account_id);
create unique index export_cases_active_unit_idx on public.export_cases (company_id, unit_id) where status <> 'cancelled';
create trigger export_cases_touch before update on public.export_cases
  for each row execute function private.touch_updated_at();

create table public.export_case_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  ruleset_item_id uuid not null,
  rule_code text not null,
  rule_title text not null,
  blocking boolean not null,
  result public.export_check_result not null,
  evidence jsonb not null default '{}'::jsonb,
  note text,
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (case_id, ruleset_item_id),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade,
  foreign key (company_id, ruleset_item_id) references public.export_ruleset_items (company_id, id)
);
create index export_case_checks_case_idx on public.export_case_checks (case_id);

-- ---------- documents and human review ----------
create table public.export_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  case_id uuid not null,
  doc_type public.export_document_kind not null,
  label text,
  storage_path text not null,
  file_name text not null check (length(trim(file_name)) > 0),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  review_status public.export_document_status not null default 'uploaded',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  extracted_fields jsonb not null default '{}'::jsonb,
  confirmed_fields jsonb not null default '{}'::jsonb,
  extraction_source text check (extraction_source is null or extraction_source in ('model', 'rules_fallback', 'manual')),
  extraction_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (storage_path),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade
);
create index export_documents_case_idx on public.export_documents (case_id, uploaded_at desc);

create table public.export_review_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  document_id uuid,
  field text not null,
  expected text,
  found text,
  severity text not null default 'blocking' check (severity in ('blocking', 'warning')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade,
  foreign key (company_id, document_id) references public.export_documents (company_id, id) on delete cascade
);
create index export_review_items_open_idx on public.export_review_items (case_id) where status = 'open';

-- AI output is a proposal, never a record change: the suggestion is logged and a person decides.
create table public.export_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  case_id uuid not null,
  document_id uuid,
  kind text not null check (kind in ('document_extraction', 'cross_document', 'message', 'summary', 'regulation')),
  model text not null,
  prompt_version text,
  input_summary jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'failed')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade,
  foreign key (company_id, document_id) references public.export_documents (company_id, id) on delete cascade
);
create index export_ai_suggestions_case_idx on public.export_ai_suggestions (case_id, created_at desc);

create table public.export_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  decision text not null default 'approved' check (decision in ('approved', 'rejected')),
  approved_by uuid not null default auth.uid() references auth.users (id),
  approved_at timestamptz not null default now(),
  ruleset_id uuid not null,
  checklist_version int not null,
  checklist_snapshot jsonb not null,
  note text,
  unique (company_id, id),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade,
  foreign key (company_id, ruleset_id) references public.export_rulesets (company_id, id)
);
create index export_approvals_case_idx on public.export_approvals (case_id, approved_at desc);

create table public.export_releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  approval_id uuid not null,
  released_by uuid not null default auth.uid() references auth.users (id),
  released_at timestamptz not null default now(),
  method text not null default 'vehicle_handover' check (method in ('vehicle_handover', 'carrier_collection', 'customs_clearance', 'other')),
  note text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (case_id),
  foreign key (company_id, case_id) references public.export_cases (company_id, id) on delete cascade,
  foreign key (company_id, approval_id) references public.export_approvals (company_id, id)
);

-- ---------- helpers ----------
create function private.export_doc_label(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'commercial_invoice' then 'Commercial invoice'
    when 'bill_of_lading' then 'Bill of lading'
    when 'road_freight_waybill' then 'Road freight waybill'
    when 'export_permit' then 'Export permit'
    when 'customs_declaration' then 'Customs declaration'
    when 'certificate_of_origin' then 'Certificate of origin'
    when 'proof_of_title' then 'Proof of title'
    when 'proof_of_export' then 'Proof of export'
    when 'payment_proof' then 'Proof of payment'
    else initcap(replace(p_kind, '_', ' ')) end;
$$;

create function private.is_export_rpc()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('kageflow.export_rpc', true), '') = 'on';
$$;

-- True only when every blocking item has a current pass and no blocking conflict is open.
create function private.export_all_pass(p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.export_ruleset_items i
             join public.export_cases c on c.ruleset_id = i.ruleset_id
            where c.id = p_case and i.blocking
         )
     and not exists (
           select 1 from public.export_ruleset_items i
             join public.export_cases c on c.ruleset_id = i.ruleset_id
            where c.id = p_case and i.blocking
              and not exists (
                select 1 from public.export_case_checks ch
                 where ch.case_id = c.id and ch.ruleset_item_id = i.id and ch.result = 'pass'
              )
         )
     and not exists (
           select 1 from public.export_review_items r
            where r.case_id = p_case and r.status = 'open' and r.severity = 'blocking'
         );
$$;

-- ---------- case guard ----------
create function private.export_case_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_origin char(2);
  v_dest char(2);
  v_rules_status text;
  v_effective date;
begin
  if tg_op = 'INSERT' then
    select origin_country, destination_country, status, effective_from
      into v_origin, v_dest, v_rules_status, v_effective
      from public.export_rulesets
     where id = new.ruleset_id and company_id = new.company_id;
    if v_origin is null then
      raise exception 'Unknown export checklist for this company';
    end if;
    if v_rules_status <> 'published' or v_effective > current_date then
      raise exception 'That checklist version is not published yet';
    end if;
    new.origin_country := v_origin;
    new.destination_country := v_dest;
    new.status := 'draft';
    new.last_evaluated_at := null;
    new.last_evaluated_by := null;
    new.approved_at := null;
    new.approved_by := null;
    new.released_at := null;
    new.released_by := null;
    if new.case_no is null then
      new.case_no := private.next_doc_number(new.company_id, 'export_case', 'EXP');
    end if;
    if new.destination_country = new.origin_country then
      raise exception 'Origin and destination must differ';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'released' and new.status <> 'released' then
      raise exception 'A released export case is final';
    end if;
    if old.status = 'approved' and new.status <> 'released' then
      raise exception 'An approved export case can only move to released';
    end if;
    if new.status = 'cancelled' and not private.has_role(new.company_id, array['owner', 'admin']::public.member_role[]) then
      raise exception 'Only owners and admins can cancel an export case';
    end if;
    if new.status in ('ready_for_approval', 'approved', 'released') and not private.is_export_rpc() then
      raise exception 'Run the readiness checklist to move this case forward';
    end if;
    if new.status = 'approved' and old.status <> 'approved'
       and not exists (select 1 from public.export_approvals a where a.case_id = new.id and a.decision = 'approved') then
      raise exception 'Approve through the approval action so the decision is recorded';
    end if;
    if new.status = 'released' and not exists (select 1 from public.export_releases r where r.case_id = new.id) then
      raise exception 'Release through the release action so the release is recorded';
    end if;
  end if;

  if new.status in ('ready_for_approval', 'approved', 'released') and not private.export_all_pass(new.id) then
    raise exception 'This export case still has unresolved requirements';
  end if;

  -- These columns are written by the recorded actions, never by a form.
  if not private.is_export_rpc()
     and (new.last_evaluated_at, new.last_evaluated_by, new.approved_at, new.approved_by, new.released_at, new.released_by)
         is distinct from
         (old.last_evaluated_at, old.last_evaluated_by, old.approved_at, old.approved_by, old.released_at, old.released_by) then
    raise exception 'Checklist, approval and release timestamps are written by their recorded action';
  end if;

  -- The facts the approval relied on are frozen once approved.
  if old.status in ('approved', 'released') then
    if (new.account_id, new.unit_id, new.order_id, new.ruleset_id, new.destination_country, new.route,
        new.incoterm, new.planned_departure, new.planned_arrival, new.proof_of_export_due_date,
        new.proof_of_export_owner)
       is distinct from
       (old.account_id, old.unit_id, old.order_id, old.ruleset_id, old.destination_country, old.route,
        old.incoterm, old.planned_departure, old.planned_arrival, old.proof_of_export_due_date,
        old.proof_of_export_owner) then
      raise exception 'An approved export case is locked. The parties, vehicle, dates and checklist cannot change';
    end if;
  elsif old.status <> 'draft'
        and (new.account_id, new.unit_id, new.order_id, new.ruleset_id, new.destination_country)
            is distinct from (old.account_id, old.unit_id, old.order_id, old.ruleset_id, old.destination_country) then
    raise exception 'The buyer, vehicle, order and checklist are fixed once readiness has been checked';
  end if;

  if new.status in ('approved', 'released') then
    if exists (
      select 1 from public.finance_applications f
       where f.company_id = new.company_id
         and (f.order_id = new.order_id or f.unit_id = new.unit_id)
         and f.status in ('submitted', 'approved', 'contracted')
    ) then
      raise exception 'Outstanding vehicle finance blocks approval and release';
    end if;
    if exists (select 1 from public.inventory_units u where u.id = new.unit_id and u.status = 'written_off') then
      raise exception 'A written-off vehicle cannot be released for export';
    end if;
  end if;

  if new.status = 'released'
     and not exists (
       select 1 from public.export_documents d
        where d.case_id = new.id and d.doc_type = 'proof_of_title' and d.review_status = 'accepted'
     ) then
    raise exception 'Proof of title must be reviewed and accepted before release';
  end if;

  return new;
end $$;
create trigger export_cases_guard before insert or update on public.export_cases
  for each row execute function private.export_case_guard();

-- ---------- document guard ----------
create function private.export_document_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_case_status public.export_case_status;
begin
  select status into v_case_status from public.export_cases where id = new.case_id;

  if tg_op = 'INSERT' then
    if new.storage_path not like new.company_id::text || '/' || new.case_id::text || '/%' then
      raise exception 'That file is not in this export case''s folder';
    end if;
    if v_case_status in ('approved', 'released', 'cancelled') then
      raise exception 'Export evidence is locked after approval or cancellation';
    end if;
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.uploaded_at := now();
    new.review_status := 'uploaded';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    return new;
  end if;

  if new.company_id is distinct from old.company_id or new.case_id is distinct from old.case_id then
    raise exception 'A document cannot be moved to another case';
  end if;
  if new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.doc_type is distinct from old.doc_type
     or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'Upload a new document instead of changing the stored file';
  end if;
  if v_case_status in ('approved', 'released', 'cancelled') then
    raise exception 'Export evidence is locked after approval or cancellation';
  end if;
  if new.review_status is not distinct from old.review_status
     and (new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'Review fields are set by the review action';
  end if;

  if new.review_status is distinct from old.review_status then
    if not private.has_role(new.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
      raise exception 'Only owners, admins and accountants can change a document review';
    end if;
    if new.review_status = 'accepted' and exists (
      select 1 from public.export_review_items r
       where r.document_id = new.id and r.status = 'open' and r.severity = 'blocking'
    ) then
      raise exception 'Resolve the document conflicts before accepting it';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  if old.review_status = 'accepted'
     and (new.storage_path is distinct from old.storage_path
          or new.confirmed_fields is distinct from old.confirmed_fields
          or new.doc_type is distinct from old.doc_type) then
    raise exception 'An accepted document is locked. Upload a new version instead';
  end if;

  return new;
end $$;
create trigger export_documents_guard before insert or update on public.export_documents
  for each row execute function private.export_document_guard();

create function private.export_document_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.export_case_status;
begin
  select status into v_status from public.export_cases where id = old.case_id;
  if v_status in ('approved', 'released', 'cancelled') then
    raise exception 'Export evidence is locked after approval or cancellation';
  end if;
  return old;
end $$;
create trigger export_documents_delete_guard before delete on public.export_documents
  for each row execute function private.export_document_delete_guard();

-- Resolution metadata is written by the database, not by the form.
create function private.export_review_item_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.company_id is distinct from old.company_id or new.case_id is distinct from old.case_id
     or new.document_id is distinct from old.document_id or new.field is distinct from old.field
     or new.expected is distinct from old.expected or new.found is distinct from old.found
     or new.severity is distinct from old.severity then
    raise exception 'A review item is a record of what the documents said and cannot be rewritten';
  end if;
  if new.status in ('resolved', 'dismissed') and new.status is distinct from old.status then
    if not private.has_role(new.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
      raise exception 'Only owners, admins and accountants can resolve a document conflict';
    end if;
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif new.status = 'open' and old.status <> 'open' then
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end $$;
create trigger export_review_items_guard before update on public.export_review_items
  for each row execute function private.export_review_item_guard();

-- The proposal is immutable. A person may only accept or reject it.
create function private.export_ai_suggestion_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;
  if new.company_id is distinct from old.company_id or new.case_id is distinct from old.case_id
     or new.created_at is distinct from old.created_at
     or new.output is distinct from old.output or new.model is distinct from old.model
     or new.kind is distinct from old.kind or new.input_summary is distinct from old.input_summary
     or new.document_id is distinct from old.document_id or new.prompt_version is distinct from old.prompt_version then
    raise exception 'A logged AI suggestion is immutable; log a new suggestion instead';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'proposed' or new.status not in ('accepted', 'rejected') then
      raise exception 'A suggestion can only be accepted or rejected once';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger export_ai_suggestions_guard before insert or update on public.export_ai_suggestions
  for each row execute function private.export_ai_suggestion_guard();

-- ---------- readiness engine ----------
-- One handler per rule code. Returns the deterministic result plus the evidence used.
create function private.export_check(p_case uuid, p_code text)
returns table (result public.export_check_result, evidence jsonb, note text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.export_cases;
  b public.crm_accounts;
  u public.inventory_units;
  o public.sales_docs;
  d public.export_documents;
  item public.export_ruleset_items;
  v_result public.export_check_result := 'pass';
  v_note text;
  v_missing text[] := '{}';
  v_evidence jsonb := '{}'::jsonb;
  v_groups jsonb;
  v_group jsonb;
  v_types text[];
  v_docs jsonb := '[]'::jsonb;
  v_n int := 0;
  v_acc int := 0;
  v_rej int := 0;
  v_pending int := 0;
  v_open int := 0;
  v_fin int := 0;
  v_due numeric := 0;
  v_count int := 0;
  v_unpaid int := 0;
  v_owner text;
  v_days int;
  v_group_state text;
  v_need text;
begin
  select * into c from public.export_cases where id = p_case;
  if c.id is null then
    return query select 'failed'::public.export_check_result, '{}'::jsonb, 'Export case not found';
    return;
  end if;
  select * into item from public.export_ruleset_items where ruleset_id = c.ruleset_id and code = p_code;
  select * into b from public.crm_accounts where id = c.account_id;
  select * into u from public.inventory_units where id = c.unit_id;
  select * into o from public.sales_docs where id = c.order_id;

  if p_code = 'buyer_destination' then
    if b.id is null then
      v_result := 'failed';
      v_note := 'The buyer record is missing';
    else
      if nullif(trim(coalesce(b.name, '')), '') is null then v_missing := v_missing || 'buyer name'::text; end if;
      if nullif(trim(coalesce(b.billing_address, '')), '') is null then v_missing := v_missing || 'buyer billing address'::text; end if;
      if nullif(trim(coalesce(b.country, '')), '') is null then v_missing := v_missing || 'buyer country'::text; end if;
      if nullif(trim(coalesce(c.route, '')), '') is null then v_missing := v_missing || 'route'::text; end if;
      if c.incoterm is null then v_missing := v_missing || 'Incoterm'::text; end if;
      if c.planned_departure is null then v_missing := v_missing || 'planned departure date'::text; end if;
      if c.planned_arrival is null then v_missing := v_missing || 'planned arrival date'::text; end if;
      if cardinality(v_missing) > 0 then
        v_result := 'missing';
        v_note := 'Add the ' || array_to_string(v_missing, ', ');
      end if;
      v_evidence := jsonb_build_object(
        'buyer', jsonb_build_object('id', b.id, 'name', b.name, 'country', b.country, 'billing_address', b.billing_address),
        'destination_country', c.destination_country,
        'route', c.route,
        'incoterm', c.incoterm,
        'incoterm_place', c.incoterm_place,
        'planned_departure', c.planned_departure,
        'planned_arrival', c.planned_arrival
      );
    end if;

  elsif p_code = 'vehicle_sale_match' then
    if o.id is null or o.doc_type <> 'order' then
      v_result := 'failed';
      v_note := 'The linked sales record is not an order';
    elsif o.status in ('draft', 'cancelled') then
      v_result := 'failed';
      v_note := 'The sales order is ' || o.status || '; confirm it before export';
    elsif o.account_id <> c.account_id then
      v_result := 'failed';
      v_note := 'The sales order belongs to a different buyer';
    elsif u.id is null then
      v_result := 'failed';
      v_note := 'The vehicle is missing from stock';
    elsif not exists (select 1 from public.sales_doc_lines l where l.doc_id = c.order_id and l.unit_id = c.unit_id) then
      v_result := 'failed';
      v_note := 'This vehicle is not on the linked sales order';
    elsif u.status = 'written_off' then
      v_result := 'failed';
      v_note := 'The vehicle is written off';
    elsif u.sold_doc_id is not null and not exists (
      select 1 from public.sales_docs si
       where si.id = u.sold_doc_id and si.company_id = c.company_id
         and (si.source_doc_id = c.order_id or si.id = c.order_id)
    ) then
      v_result := 'failed';
      v_note := 'The vehicle is already sold on a different document';
    elsif u.status = 'sold' and u.sold_doc_id is null then
      v_result := 'needs_review';
      v_note := 'The vehicle is marked sold but is not linked to an invoice';
    elsif upper(u.serial_no) !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      v_result := 'failed';
      v_note := 'The vehicle serial is not a 17-character VIN';
    elsif not u.vin_confirmed then
      v_result := 'needs_review';
      v_note := 'Confirm the VIN on the vehicle before export';
    end if;
    v_evidence := jsonb_build_object(
      'vehicle', jsonb_build_object('id', u.id, 'vin', u.serial_no, 'make', u.make, 'model', u.model,
                                    'year', u.year, 'status', u.status, 'vin_confirmed', u.vin_confirmed,
                                    'sold_document_id', u.sold_doc_id),
      'order', jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'account_id', o.account_id),
      'on_order', exists (select 1 from public.sales_doc_lines l where l.doc_id = c.order_id and l.unit_id = c.unit_id)
    );

  elsif p_code = 'finance_title_clear' then
    select count(*) into v_fin
      from public.finance_applications f
     where f.company_id = c.company_id
       and (f.order_id = c.order_id or f.unit_id = c.unit_id)
       and f.status in ('submitted', 'approved', 'contracted');

    select * into d from public.export_documents
     where case_id = c.id and doc_type = 'proof_of_title' and review_status = 'accepted'
     order by uploaded_at desc limit 1;
    if d.id is null then
      select * into d from public.export_documents
       where case_id = c.id and doc_type = 'proof_of_title'
       order by uploaded_at desc limit 1;
    end if;

    if u.id is null then
      v_result := 'failed';
      v_note := 'The vehicle is missing from stock';
    elsif u.status = 'written_off' then
      v_result := 'failed';
      v_note := 'The vehicle is written off';
    elsif v_fin > 0 then
      v_result := 'failed';
      v_note := 'Bank finance on this sale is still outstanding';
    elsif d.id is null then
      if u.reg_doc_path is not null then
        v_result := 'needs_review';
        v_note := 'A registration document is on file; upload and review it as proof of title for this export';
      else
        v_result := 'missing';
        v_note := 'Proof of title is missing';
      end if;
    elsif d.review_status = 'accepted' then
      v_result := 'pass';
    elsif d.review_status = 'rejected' then
      v_result := 'failed';
      v_note := 'The proof of title was rejected';
    else
      v_result := 'needs_review';
      v_note := 'The proof of title is waiting for review';
    end if;
    v_evidence := jsonb_build_object(
      'outstanding_finance', v_fin,
      'proof_of_title', case when d.id is null then null else jsonb_build_object(
        'id', d.id, 'file_name', d.file_name, 'review_status', d.review_status
      ) end,
      'vehicle_registration_document', u.reg_doc_path is not null,
      'vehicle_status', u.status
    );

  elsif p_code = 'customs_documents' then
    v_groups := coalesce(item.params -> 'document_groups', '[]'::jsonb);
    if jsonb_array_length(v_groups) = 0 then
      v_groups := '[["commercial_invoice"],["road_freight_waybill","bill_of_lading"],["export_permit"],["customs_declaration"]]'::jsonb;
    end if;
    for v_group in select * from jsonb_array_elements(v_groups) loop
      v_types := array(select jsonb_array_elements_text(v_group));
      select count(*),
             count(*) filter (where x.review_status = 'accepted'),
             count(*) filter (where x.review_status = 'rejected'),
             count(*) filter (where x.review_status in ('uploaded', 'in_review'))
        into v_n, v_acc, v_rej, v_pending
        from public.export_documents x
       where x.case_id = c.id and x.doc_type::text = any (v_types);

      if v_n = 0 then
        v_group_state := 'missing';
        v_need := (select string_agg(private.export_doc_label(t), ' or ') from unnest(v_types) t);
        v_note := concat_ws('; ', v_note, 'Missing ' || v_need);
        if v_result <> 'failed' then v_result := 'missing'; end if;
      elsif v_acc > 0 then
        v_group_state := 'present';
      elsif v_pending > 0 then
        v_group_state := 'in_review';
        if v_result = 'pass' then v_result := 'needs_review'; end if;
      else
        v_group_state := 'rejected';
        v_result := 'failed';
        v_need := (select string_agg(private.export_doc_label(t), ' or ') from unnest(v_types) t);
        v_note := concat_ws('; ', v_note, 'Rejected ' || v_need);
      end if;

      v_docs := v_docs || jsonb_build_array(jsonb_build_object(
        'types', to_jsonb(v_types),
        'state', v_group_state,
        'documents', coalesce((
          select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.doc_type, 'label', coalesce(x.label, private.export_doc_label(x.doc_type::text)),
                                              'status', x.review_status, 'file_name', x.file_name))
            from public.export_documents x
           where x.case_id = c.id and x.doc_type::text = any (v_types)
        ), '[]'::jsonb)
      ));
    end loop;

    select count(*) into v_open
      from public.export_review_items r
     where r.case_id = c.id and r.status = 'open' and r.severity = 'blocking';
    if v_open > 0 then
      v_result := 'failed';
      v_note := concat_ws('; ', v_note, v_open::text || ' document conflict' || case when v_open = 1 then '' else 's' end || ' need resolving');
    end if;
    v_evidence := jsonb_build_object('requirements', v_docs, 'open_conflicts', v_open);

  elsif p_code = 'payment_conditions' then
    if o.id is null or o.doc_type <> 'order' then
      v_result := 'failed';
      v_note := 'The linked sales record is not an order';
    elsif o.status in ('draft', 'cancelled') then
      v_result := 'failed';
      v_note := 'The sales order is ' || o.status;
    else
      select count(*), coalesce(sum(x.amount_due), 0), count(*) filter (where x.amount_due > 0)
        into v_count, v_due, v_unpaid
        from public.sales_docs x
       where x.company_id = c.company_id and x.doc_type = 'invoice' and x.status = 'issued'
         and x.source_doc_id = c.order_id;
      if v_count = 0 then
        v_result := 'missing';
        v_note := 'Issue the invoice for this order';
      elsif v_unpaid > 0 then
        v_result := 'failed';
        v_note := 'The invoice still has ' || to_char(v_due, 'FM999999990.00') || ' outstanding';
      end if;
    end if;
    v_evidence := jsonb_build_object(
      'order_status', o.status,
      'currency', o.currency,
      'order_total', o.total,
      'issued_invoices', v_count,
      'amount_due', v_due
    );

  elsif p_code = 'proof_of_export' then
    if c.proof_of_export_due_date is null then
      v_result := 'missing';
      v_note := 'Set the proof-of-export due date';
    elsif c.proof_of_export_owner is null then
      v_result := 'missing';
      v_note := 'Choose who owns the proof of export';
    else
      select coalesce(p.full_name, p.email) into v_owner
        from public.company_members m join public.profiles p on p.id = m.user_id
       where m.company_id = c.company_id and m.user_id = c.proof_of_export_owner;
      select * into d from public.export_documents
       where case_id = c.id and doc_type = 'proof_of_export' and review_status = 'accepted'
       order by uploaded_at desc limit 1;
      v_days := c.proof_of_export_due_date - current_date;
      if v_owner is null then
        v_result := 'failed';
        v_note := 'The proof-of-export owner is no longer on the team';
      elsif d.id is not null then
        v_result := 'pass';
      elsif v_days < 0 then
        v_result := 'failed';
        v_note := 'Proof of export is overdue since ' || to_char(c.proof_of_export_due_date, 'DD Mon YYYY');
      else
        v_result := 'pass';
        v_note := 'Due ' || to_char(c.proof_of_export_due_date, 'DD Mon YYYY') || ' (' || v_days || ' days left)';
      end if;
    end if;
    v_evidence := jsonb_build_object(
      'due_date', c.proof_of_export_due_date,
      'days_remaining', v_days,
      'owner_id', c.proof_of_export_owner,
      'owner_name', v_owner,
      'evidence_document', case when d.id is null then null else jsonb_build_object('id', d.id, 'file_name', d.file_name) end
    );

  else
    v_result := 'failed';
    v_note := 'No deterministic handler is installed for rule ' || p_code;
  end if;

  return query select v_result, v_evidence, v_note;
end $$;

create function private.export_refresh_checks(p_case uuid)
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
begin
  select * into c from public.export_cases where id = p_case;
  if c.id is null then
    raise exception 'Export case not found';
  end if;

  for i in select * from public.export_ruleset_items where ruleset_id = c.ruleset_id order by position loop
    select * into chk from private.export_check(c.id, i.code);
    insert into public.export_case_checks
      (company_id, case_id, ruleset_item_id, rule_code, rule_title, blocking, result, evidence, note, checked_by, checked_at)
    values
      (c.company_id, c.id, i.id, i.code, i.title, i.blocking, chk.result, coalesce(chk.evidence, '{}'::jsonb), chk.note, auth.uid(), now())
    on conflict (case_id, ruleset_item_id) do update
      set result = excluded.result,
          evidence = excluded.evidence,
          note = excluded.note,
          checked_by = excluded.checked_by,
          checked_at = excluded.checked_at;

    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'code', i.code, 'title', i.title, 'blocking', i.blocking, 'result', chk.result,
      'note', chk.note, 'evidence', chk.evidence
    ));
    if i.blocking and chk.result in ('missing', 'failed') then
      v_failed := v_failed + 1;
    elsif i.blocking and chk.result = 'needs_review' then
      v_review := v_review + 1;
    end if;
    if chk.result <> 'pass' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', i.code, 'title', i.title, 'result', chk.result, 'note', chk.note
      ));
    end if;
  end loop;

  select count(*) into v_open
    from public.export_review_items r
   where r.case_id = c.id and r.status = 'open' and r.severity = 'blocking';

  return jsonb_build_object(
    'checks', v_checks,
    'blockers', v_blockers,
    'failed', v_failed,
    'needs_review', v_review,
    'open_reviews', v_open
  );
end $$;

create function public.evaluate_export_case(p_case uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.export_cases;
  v_summary jsonb;
  v_status public.export_case_status;
  v_failed int;
  v_review int;
  v_open int;
begin
  select * into c from public.export_cases where id = p_case for update;
  if c.id is null then
    raise exception 'Export case not found';
  end if;
  if not private.has_role(c.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Your role can view export cases but not check them';
  end if;
  if c.status in ('approved', 'released', 'cancelled') then
    raise exception 'This export case is % and can no longer be checked', c.status;
  end if;

  v_summary := private.export_refresh_checks(c.id);
  v_failed := coalesce((v_summary ->> 'failed')::int, 0);
  v_review := coalesce((v_summary ->> 'needs_review')::int, 0);
  v_open := coalesce((v_summary ->> 'open_reviews')::int, 0);

  v_status := (case
    when v_failed > 0 or v_open > 0 then 'blocked'
    when v_review > 0 then 'in_review'
    else 'ready_for_approval'
  end)::public.export_case_status;

  perform set_config('kageflow.export_rpc', 'on', true);
  update public.export_cases
     set status = v_status, last_evaluated_at = now(), last_evaluated_by = auth.uid()
   where id = c.id;

  return v_summary || jsonb_build_object(
    'case_id', c.id,
    'status', v_status,
    'ruleset_version', (select version from public.export_rulesets where id = c.ruleset_id)
  );
end $$;

-- ---------- document review ----------
create function public.review_export_document(p_document uuid, p_status public.export_document_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.export_documents;
  c public.export_cases;
begin
  if p_status is null or p_status not in ('accepted', 'rejected') then
    raise exception 'Choose accepted or rejected';
  end if;
  select * into d from public.export_documents where id = p_document for update;
  if d.id is null then
    raise exception 'Document not found';
  end if;
  if not private.has_role(d.company_id, array['owner', 'admin', 'accountant']::public.member_role[]) then
    raise exception 'Only owners, admins and accountants can review export documents';
  end if;
  if p_status = 'accepted' and exists (
    select 1 from public.export_review_items r
     where r.document_id = d.id and r.status = 'open' and r.severity = 'blocking'
  ) then
    raise exception 'Resolve the document conflicts before accepting it';
  end if;

  update public.export_documents
     set review_status = p_status, review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = d.id;

  select * into c from public.export_cases where id = d.case_id;
  if c.status not in ('approved', 'released', 'cancelled') then
    perform public.evaluate_export_case(c.id);
  end if;
end $$;

-- A person confirms what the document says. The comparison with Kageflow is deterministic and
-- creates review items; nothing in the buyer, vehicle or sales records is overwritten.
create function public.confirm_export_extraction(p_document uuid, p_fields jsonb, p_suggestion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.export_documents;
  c public.export_cases;
  u public.inventory_units;
  a public.crm_accounts;
  o public.sales_docs;
  v_found text;
  v_expected text;
  v_num numeric;
  v_items int := 0;
  v_invoice_date date;
begin
  select * into d from public.export_documents where id = p_document for update;
  if d.id is null then
    raise exception 'Document not found';
  end if;
  if not private.has_role(d.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Your role cannot confirm document fields';
  end if;
  select * into c from public.export_cases where id = d.case_id;
  if c.status in ('approved', 'released', 'cancelled') then
    raise exception 'Export evidence is locked after approval or cancellation';
  end if;
  if d.review_status = 'accepted' then
    raise exception 'An accepted document is locked';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Confirmed fields must be an object';
  end if;
  if length(p_fields::text) > 20000 then
    raise exception 'The confirmed fields are too large';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_fields) k
     where k not in ('vin', 'buyer_name', 'invoice_number', 'currency', 'issue_date', 'departure_date', 'total')
  ) then
    raise exception 'One of the confirmed fields is not recognised';
  end if;

  if p_suggestion is not null then
    update public.export_ai_suggestions
       set status = 'accepted',
           decision_note = 'Fields confirmed or corrected by a person'
     where id = p_suggestion and document_id = d.id and company_id = d.company_id and status = 'proposed';
  end if;

  update public.export_documents
     set confirmed_fields = p_fields,
         extraction_source = coalesce(extraction_source, 'manual'),
         extraction_at = coalesce(extraction_at, now())
   where id = d.id;

  delete from public.export_review_items
   where document_id = d.id and status = 'open';

  select * into u from public.inventory_units where id = c.unit_id;
  select * into a from public.crm_accounts where id = c.account_id;
  select * into o from public.sales_docs where id = c.order_id;

  -- VIN
  v_found := nullif(upper(regexp_replace(coalesce(p_fields ->> 'vin', ''), '[^A-Za-z0-9]', '', 'g')), '');
  if v_found is not null then
    v_expected := upper(regexp_replace(coalesce(u.serial_no, ''), '[^A-Za-z0-9]', '', 'g'));
    if v_found <> v_expected then
      insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
      values (c.company_id, c.id, d.id, 'VIN', v_expected, v_found, 'blocking', auth.uid());
      v_items := v_items + 1;
    end if;
  end if;

  -- Buyer name
  v_found := nullif(trim(coalesce(p_fields ->> 'buyer_name', '')), '');
  if v_found is not null and lower(v_found) <> lower(a.name) then
    insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
    values (c.company_id, c.id, d.id, 'Buyer name', a.name, v_found, 'blocking', auth.uid());
    v_items := v_items + 1;
  end if;

  -- Invoice number
  v_found := nullif(trim(coalesce(p_fields ->> 'invoice_number', '')), '');
  if v_found is not null
     and lower(v_found) <> lower(coalesce(o.number, ''))
     and not exists (
       select 1 from public.sales_docs x
        where x.company_id = c.company_id and x.doc_type = 'invoice'
          and x.source_doc_id = c.order_id and lower(coalesce(x.number, '')) = lower(v_found)
     ) then
    insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
    values (c.company_id, c.id, d.id, 'Invoice number', o.number, v_found, 'blocking', auth.uid());
    v_items := v_items + 1;
  end if;

  -- Currency
  v_found := nullif(upper(trim(coalesce(p_fields ->> 'currency', ''))), '');
  if v_found is not null and v_found <> upper(trim(o.currency::text)) then
    insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
    values (c.company_id, c.id, d.id, 'Currency', upper(trim(o.currency::text)), v_found, 'blocking', auth.uid());
    v_items := v_items + 1;
  end if;

  -- Invoice date and departure date are advisory: a difference is worth a look, not a block.
  select x.issue_date into v_invoice_date
    from public.sales_docs x
   where x.company_id = c.company_id and x.doc_type = 'invoice' and x.source_doc_id = c.order_id
   order by x.created_at desc limit 1;
  v_found := nullif(trim(coalesce(p_fields ->> 'issue_date', '')), '');
  if v_found is not null and v_found <> coalesce(v_invoice_date, o.issue_date)::text then
    insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
    values (c.company_id, c.id, d.id, 'Invoice date', coalesce(v_invoice_date, o.issue_date)::text, v_found, 'warning', auth.uid());
    v_items := v_items + 1;
  end if;
  v_found := nullif(trim(coalesce(p_fields ->> 'departure_date', '')), '');
  if v_found is not null and c.planned_departure::text is distinct from v_found then
    insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
    values (c.company_id, c.id, d.id, 'Departure date', c.planned_departure::text, v_found, 'warning', auth.uid());
    v_items := v_items + 1;
  end if;

  -- Total
  v_found := nullif(trim(coalesce(p_fields ->> 'total', '')), '');
  if v_found is not null then
    begin
      v_num := nullif(regexp_replace(v_found, '[^0-9.]', '', 'g'), '')::numeric;
    exception when others then
      v_num := null;
    end;
    if v_num is not null and abs(v_num - o.total) > 0.01 then
      insert into public.export_review_items (company_id, case_id, document_id, field, expected, found, severity, created_by)
      values (c.company_id, c.id, d.id, 'Total', to_char(o.total, 'FM999999990.00'), v_found, 'warning', auth.uid());
      v_items := v_items + 1;
    end if;
  end if;

  if c.status <> 'cancelled' then
    perform public.evaluate_export_case(c.id);
  end if;

  return jsonb_build_object(
    'review_items', v_items,
    'case_status', (select status from public.export_cases where id = c.id)
  );
end $$;

-- ---------- approval and controlled release ----------
create function public.reject_export_case(p_case uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.export_cases;
  v_summary jsonb;
  v_failed int;
  v_review int;
  v_open int;
  v_snapshot jsonb;
  v_approval uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the release is being rejected';
  end if;
  select * into c from public.export_cases where id = p_case for update;
  if c.id is null then
    raise exception 'Export case not found';
  end if;
  if not private.has_role(c.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can reject an export release';
  end if;
  if c.status <> 'ready_for_approval' then
    raise exception 'Only a case that is ready for approval can be rejected (it is %)', c.status;
  end if;

  v_summary := private.export_refresh_checks(c.id);
  v_failed := coalesce((v_summary ->> 'failed')::int, 0);
  v_review := coalesce((v_summary ->> 'needs_review')::int, 0);
  v_open := coalesce((v_summary ->> 'open_reviews')::int, 0);
  if v_failed > 0 or v_review > 0 or v_open > 0 or not private.export_all_pass(c.id) then
    raise exception 'This export case no longer passes the checklist and cannot be signed off';
  end if;

  select jsonb_agg(jsonb_build_object(
           'code', ch.rule_code, 'title', ch.rule_title, 'blocking', ch.blocking,
           'result', ch.result, 'evidence', ch.evidence, 'note', ch.note,
           'checked_by', ch.checked_by, 'checked_at', ch.checked_at
         ) order by i.position)
    into v_snapshot
    from public.export_case_checks ch
    join public.export_ruleset_items i on i.id = ch.ruleset_item_id
   where ch.case_id = c.id;

  insert into public.export_approvals
    (company_id, case_id, decision, approved_by, ruleset_id, checklist_version, checklist_snapshot, note)
  values
    (c.company_id, c.id, 'rejected', auth.uid(), c.ruleset_id,
     (select version from public.export_rulesets where id = c.ruleset_id),
     jsonb_build_object(
       'ruleset_id', c.ruleset_id,
       'version', (select version from public.export_rulesets where id = c.ruleset_id),
       'source_title', (select source_title from public.export_rulesets where id = c.ruleset_id),
       'source_url', (select source_url from public.export_rulesets where id = c.ruleset_id),
       'effective_from', (select effective_from from public.export_rulesets where id = c.ruleset_id),
       'items', coalesce(v_snapshot, '[]'::jsonb)
     ),
     trim(p_reason))
  returning id into v_approval;

  perform set_config('kageflow.export_rpc', 'on', true);
  update public.export_cases
     set status = 'in_review', last_evaluated_at = now(), last_evaluated_by = auth.uid()
   where id = c.id;
  return v_approval;
end $$;

create function public.approve_export_case(p_case uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.export_cases;
  v_summary jsonb;
  v_failed int;
  v_review int;
  v_open int;
  v_snapshot jsonb;
  v_approval uuid;
begin
  select * into c from public.export_cases where id = p_case for update;
  if c.id is null then
    raise exception 'Export case not found';
  end if;
  if not private.has_role(c.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can approve an export release';
  end if;
  if c.status <> 'ready_for_approval' then
    raise exception 'Only a case that is ready for approval can be approved (it is %)', c.status;
  end if;

  v_summary := private.export_refresh_checks(c.id);
  v_failed := coalesce((v_summary ->> 'failed')::int, 0);
  v_review := coalesce((v_summary ->> 'needs_review')::int, 0);
  v_open := coalesce((v_summary ->> 'open_reviews')::int, 0);
  if v_failed > 0 or v_review > 0 or v_open > 0 then
    raise exception 'This export case still has unresolved requirements';
  end if;
  if not private.export_all_pass(c.id) then
    raise exception 'This export case still has unresolved requirements';
  end if;
  if not exists (
    select 1 from public.export_rulesets r
     where r.id = c.ruleset_id and r.status in ('published', 'retired') and r.effective_from <= current_date
  ) then
    raise exception 'The checklist version is not effective';
  end if;
  if exists (
    select 1 from public.finance_applications f
     where f.company_id = c.company_id
       and (f.order_id = c.order_id or f.unit_id = c.unit_id)
       and f.status in ('submitted', 'approved', 'contracted')
  ) then
    raise exception 'Outstanding vehicle finance blocks approval';
  end if;
  if not exists (
    select 1 from public.export_documents d
     where d.case_id = c.id and d.doc_type = 'proof_of_title' and d.review_status = 'accepted'
  ) then
    raise exception 'Proof of title must be reviewed and accepted before approval';
  end if;

  select jsonb_agg(jsonb_build_object(
           'code', ch.rule_code, 'title', ch.rule_title, 'blocking', ch.blocking,
           'result', ch.result, 'evidence', ch.evidence, 'note', ch.note,
           'checked_by', ch.checked_by, 'checked_at', ch.checked_at
         ) order by i.position)
    into v_snapshot
    from public.export_case_checks ch
    join public.export_ruleset_items i on i.id = ch.ruleset_item_id
   where ch.case_id = c.id;

  insert into public.export_approvals
    (company_id, case_id, decision, approved_by, ruleset_id, checklist_version, checklist_snapshot, note)
  values
    (c.company_id, c.id, 'approved', auth.uid(), c.ruleset_id,
     (select version from public.export_rulesets where id = c.ruleset_id),
     jsonb_build_object(
       'ruleset_id', c.ruleset_id,
       'version', (select version from public.export_rulesets where id = c.ruleset_id),
       'source_title', (select source_title from public.export_rulesets where id = c.ruleset_id),
       'source_url', (select source_url from public.export_rulesets where id = c.ruleset_id),
       'effective_from', (select effective_from from public.export_rulesets where id = c.ruleset_id),
       'items', coalesce(v_snapshot, '[]'::jsonb)
     ),
     nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_approval;

  perform set_config('kageflow.export_rpc', 'on', true);
  update public.export_cases
     set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         last_evaluated_at = now(), last_evaluated_by = auth.uid()
   where id = c.id;

  return v_approval;
end $$;

create function public.release_export_case(p_case uuid, p_method text default 'vehicle_handover', p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.export_cases;
  a public.export_approvals;
  v_summary jsonb;
  v_failed int;
  v_review int;
  v_open int;
  v_release uuid;
begin
  select * into c from public.export_cases where id = p_case for update;
  if c.id is null then
    raise exception 'Export case not found';
  end if;
  if not private.has_role(c.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can release an export';
  end if;
  if c.status <> 'approved' then
    raise exception 'The case must be approved before release (it is %)', c.status;
  end if;
  if p_method is null or p_method not in ('vehicle_handover', 'carrier_collection', 'customs_clearance', 'other') then
    raise exception 'Choose how the vehicle is being released';
  end if;

  select * into a from public.export_approvals
   where case_id = c.id and decision = 'approved'
   order by approved_at desc limit 1;
  if a.id is null then
    raise exception 'No approval record exists for this case';
  end if;
  if a.ruleset_id <> c.ruleset_id then
    raise exception 'The approval was given against a different checklist version';
  end if;

  -- Re-run the whole checklist at the moment of release; stale checks cannot release a car.
  v_summary := private.export_refresh_checks(c.id);
  v_failed := coalesce((v_summary ->> 'failed')::int, 0);
  v_review := coalesce((v_summary ->> 'needs_review')::int, 0);
  v_open := coalesce((v_summary ->> 'open_reviews')::int, 0);
  if v_failed > 0 or v_review > 0 or v_open > 0 or not private.export_all_pass(c.id) then
    raise exception 'This export case no longer passes the checklist and cannot be released';
  end if;
  if exists (
    select 1 from public.finance_applications f
     where f.company_id = c.company_id
       and (f.order_id = c.order_id or f.unit_id = c.unit_id)
       and f.status in ('submitted', 'approved', 'contracted')
  ) then
    raise exception 'Outstanding vehicle finance blocks release';
  end if;
  if exists (select 1 from public.inventory_units u where u.id = c.unit_id and u.status = 'written_off') then
    raise exception 'A written-off vehicle cannot be released for export';
  end if;
  if not exists (
    select 1 from public.export_documents d
     where d.case_id = c.id and d.doc_type = 'proof_of_title' and d.review_status = 'accepted'
  ) then
    raise exception 'Proof of title must be reviewed and accepted before release';
  end if;

  insert into public.export_releases (company_id, case_id, approval_id, released_by, method, note)
  values (c.company_id, c.id, a.id, auth.uid(), p_method, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_release;

  perform set_config('kageflow.export_rpc', 'on', true);
  update public.export_cases
     set status = 'released', released_at = now(), released_by = auth.uid(),
         last_evaluated_at = now(), last_evaluated_by = auth.uid()
   where id = c.id;

  -- Advance the order tracker as the controlled post-approval action.
  update public.sales_docs
     set tracking_stage = 'Released for export'
   where id = c.order_id and company_id = c.company_id;

  return v_release;
end $$;

-- ---------- ruleset publishing ----------
create function public.create_export_ruleset_version(p_company uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_current public.export_rulesets;
  v_new uuid;
  v_version int;
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can version the export checklist';
  end if;
  select * into v_current from public.export_rulesets
   where company_id = p_company and status = 'published'
   order by version desc limit 1;
  if v_current.id is null then
    raise exception 'There is no published checklist to version';
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from public.export_rulesets where company_id = p_company and corridor_code = v_current.corridor_code;
  insert into public.export_rulesets
    (company_id, corridor_code, origin_country, destination_country, version, status, title,
     source_title, source_url, effective_from, notes, created_by)
  values
    (p_company, v_current.corridor_code, v_current.origin_country, v_current.destination_country,
     v_version, 'draft', v_current.title, v_current.source_title, v_current.source_url,
     current_date, v_current.notes, auth.uid())
  returning id into v_new;
  insert into public.export_ruleset_items
    (company_id, ruleset_id, code, title, description, category, blocking, evidence_hint, params, position)
  select p_company, v_new, code, title, description, category, blocking, evidence_hint, params, position
    from public.export_ruleset_items where ruleset_id = v_current.id;
  return v_new;
end $$;

create function public.publish_export_ruleset(p_ruleset uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.export_rulesets;
begin
  select * into r from public.export_rulesets where id = p_ruleset for update;
  if r.id is null then
    raise exception 'Checklist not found';
  end if;
  if not private.has_role(r.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can publish the export checklist';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only a draft checklist can be published';
  end if;
  if not exists (select 1 from public.export_ruleset_items where ruleset_id = r.id) then
    raise exception 'A checklist needs at least one rule';
  end if;
  update public.export_rulesets
     set status = 'retired'
   where company_id = r.company_id and corridor_code = r.corridor_code and status = 'published';
  update public.export_rulesets
     set status = 'published', published_by = auth.uid(), published_at = now(), effective_from = current_date
   where id = r.id;
end $$;

-- ---------- seed one corridor per company ----------
create function private.seed_export_rules(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_origin char(2);
  v_dest char(2);
  v_owner uuid;
  v_ruleset uuid;
  v_corridor text;
  v_source text;
  v_url text;
  v_title text;
  v_notes text;
begin
  select country into v_origin from public.companies where id = p_company;
  if v_origin is null or v_origin not in ('ZA', 'ZW') then
    return;
  end if;
  select user_id into v_owner from public.company_members
   where company_id = p_company and role = 'owner'
   order by created_at limit 1;
  if v_owner is null then
    select created_by into v_owner from public.companies where id = p_company;
  end if;
  v_owner := coalesce(v_owner, auth.uid());
  v_dest := (case when v_origin = 'ZA' then 'ZW' else 'ZA' end)::char(2);
  v_corridor := v_origin || '-' || v_dest;
  if exists (select 1 from public.export_rulesets where company_id = p_company and corridor_code = v_corridor) then
    return;
  end if;

  if v_origin = 'ZA' then
    v_title := 'South Africa to Zimbabwe: road export readiness';
    v_source := 'SARS export documentation and proof-of-export guidance; ZIMRA import clearance for the Beitbridge corridor';
    v_url := 'https://www.sars.gov.za/customs-and-excise/';
  else
    v_title := 'Zimbabwe to South Africa: road export readiness';
    v_source := 'ZIMRA export clearance and SARS import guidance for the Beitbridge corridor';
    v_url := 'https://www.zimra.co.zw/';
  end if;
  v_notes := 'Seeded corridor template. The compliance owner must review the source and publish a new version when the rules change. The checklist is a control, not legal advice.';

  insert into public.export_rulesets
    (company_id, corridor_code, origin_country, destination_country, version, status, title,
     source_title, source_url, effective_from, notes, published_by, published_at, created_by)
  values
    (p_company, v_corridor, v_origin, v_dest, 1, 'published', v_title,
     v_source, v_url, current_date, v_notes, v_owner, now(), v_owner)
  returning id into v_ruleset;

  insert into public.export_ruleset_items
    (company_id, ruleset_id, code, title, description, category, blocking, evidence_hint, params, position)
  values
    (p_company, v_ruleset, 'buyer_destination', 'Buyer and destination details are complete',
     'The buyer has a name, billing address and country; the case has a route, Incoterm and planned dates.',
     'party', true, 'CRM account and export case details', '{}'::jsonb, 1),
    (p_company, v_ruleset, 'vehicle_sale_match', 'Vehicle identity is confirmed and matches the sale',
     'The vehicle is on the sales order, has a valid 17-character VIN, and that VIN has been inspected on the car.',
     'vehicle', true, 'VIN inspection and the sales order line', '{"require_vin_confirmed": true}'::jsonb, 2),
    (p_company, v_ruleset, 'finance_title_clear', 'Finance and title checks are clear',
     'No bank finance is still outstanding on the sale, and an accepted proof of title is on file for the vehicle.',
     'finance_title', true, 'Finance applications and a reviewed proof of title', '{"require_proof_of_title": true}'::jsonb, 3),
    (p_company, v_ruleset, 'customs_documents', 'Required permits and customs documents are present',
     'Each required document group has at least one reviewed, accepted document; rejected or conflicting documents block.',
     'documents', true, 'Commercial invoice, waybill, export permit, customs declaration and certificate of origin',
     '{"document_groups": [["commercial_invoice"], ["road_freight_waybill", "bill_of_lading"], ["export_permit"], ["customs_declaration"], ["certificate_of_origin"]]}'::jsonb, 4),
    (p_company, v_ruleset, 'payment_conditions', 'Required payment conditions are met',
     'The order is confirmed and every issued invoice for it is settled. The corridor rule is payment in full before release.',
     'payment', true, 'Issued invoice and payment allocations', '{"full_payment_required": true}'::jsonb, 5),
    (p_company, v_ruleset, 'proof_of_export', 'Proof-of-export evidence has a due date and owner',
     'A named team member owns the proof of export and its due date has not passed without accepted evidence.',
     'evidence', true, 'Proof-of-export due date, owner and accepted evidence', '{"overdue_blocks": true}'::jsonb, 6);
end $$;

create function private.seed_export_rules_after_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_export_rules(new.id);
  return new;
end $$;
create trigger companies_seed_export_rules after insert on public.companies
  for each row execute function private.seed_export_rules_after_company();

do $seed$
declare
  c record;
begin
  for c in select id from public.companies loop
    perform private.seed_export_rules(c.id);
  end loop;
end $seed$;

-- ---------- RLS ----------
alter table public.export_rulesets enable row level security;
alter table public.export_ruleset_items enable row level security;
alter table public.export_cases enable row level security;
alter table public.export_case_checks enable row level security;
alter table public.export_documents enable row level security;
alter table public.export_review_items enable row level security;
alter table public.export_ai_suggestions enable row level security;
alter table public.export_approvals enable row level security;
alter table public.export_releases enable row level security;

create policy export_rulesets_select on public.export_rulesets for select to authenticated
  using (private.is_member(company_id));
create policy export_ruleset_items_select on public.export_ruleset_items for select to authenticated
  using (private.is_member(company_id));

create policy export_cases_select on public.export_cases for select to authenticated
  using (private.is_member(company_id));
create policy export_cases_insert on public.export_cases for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_cases_update on public.export_cases for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy export_case_checks_select on public.export_case_checks for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy export_documents_select on public.export_documents for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_documents_insert on public.export_documents for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_documents_update on public.export_documents for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_documents_remove on public.export_documents for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy export_review_items_select on public.export_review_items for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_review_items_update on public.export_review_items for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy export_review_items_remove on public.export_review_items for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy export_ai_suggestions_select on public.export_ai_suggestions for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_ai_suggestions_insert on public.export_ai_suggestions for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_ai_suggestions_update on public.export_ai_suggestions for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

create policy export_approvals_select on public.export_approvals for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_releases_select on public.export_releases for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

revoke all on public.export_rulesets, public.export_ruleset_items, public.export_cases,
              public.export_case_checks, public.export_documents, public.export_review_items,
              public.export_ai_suggestions, public.export_approvals, public.export_releases from anon;
revoke insert, update, delete on public.export_rulesets, public.export_ruleset_items,
                                  public.export_case_checks, public.export_approvals,
                                  public.export_releases from authenticated;
revoke insert on public.export_review_items from authenticated;

-- ---------- private storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('export-documents', 'export-documents', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy export_documents_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'export-documents'
         and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_documents_storage_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'export-documents'
              and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy export_documents_storage_drop on storage.objects for delete to authenticated
  using (bucket_id = 'export-documents'
         and private.has_role(private.storage_company(name), array['owner', 'admin']::public.member_role[]));

-- ---------- audit ----------
create trigger audit_export_rulesets after insert or update or delete on public.export_rulesets
  for each row execute function private.audit_row();
create trigger audit_export_ruleset_items after insert or update or delete on public.export_ruleset_items
  for each row execute function private.audit_row();
create trigger audit_export_cases after insert or update or delete on public.export_cases
  for each row execute function private.audit_row();
create trigger audit_export_case_checks after insert or update or delete on public.export_case_checks
  for each row execute function private.audit_row();
create trigger audit_export_documents after insert or update or delete on public.export_documents
  for each row execute function private.audit_row();
create trigger audit_export_review_items after insert or update or delete on public.export_review_items
  for each row execute function private.audit_row();
create trigger audit_export_ai_suggestions after insert or update or delete on public.export_ai_suggestions
  for each row execute function private.audit_row();
create trigger audit_export_approvals after insert or update or delete on public.export_approvals
  for each row execute function private.audit_row();
create trigger audit_export_releases after insert or update or delete on public.export_releases
  for each row execute function private.audit_row();

-- ---------- grants ----------
revoke all on function public.evaluate_export_case(uuid) from public, anon;
revoke all on function public.review_export_document(uuid, public.export_document_status, text) from public, anon;
revoke all on function public.confirm_export_extraction(uuid, jsonb, uuid) from public, anon;
revoke all on function public.reject_export_case(uuid, text) from public, anon;
revoke all on function public.approve_export_case(uuid, text) from public, anon;
revoke all on function public.release_export_case(uuid, text, text) from public, anon;
revoke all on function public.create_export_ruleset_version(uuid) from public, anon;
revoke all on function public.publish_export_ruleset(uuid) from public, anon;
grant execute on function public.evaluate_export_case(uuid) to authenticated;
grant execute on function public.review_export_document(uuid, public.export_document_status, text) to authenticated;
grant execute on function public.confirm_export_extraction(uuid, jsonb, uuid) to authenticated;
grant execute on function public.reject_export_case(uuid, text) to authenticated;
grant execute on function public.approve_export_case(uuid, text) to authenticated;
grant execute on function public.release_export_case(uuid, text, text) to authenticated;
grant execute on function public.create_export_ruleset_version(uuid) to authenticated;
grant execute on function public.publish_export_ruleset(uuid) to authenticated;

revoke all on function private.export_check(uuid, text) from public, anon, authenticated;
revoke all on function private.export_refresh_checks(uuid) from public, anon, authenticated;
revoke all on function private.export_all_pass(uuid) from public, anon, authenticated;
revoke all on function private.is_export_rpc() from public, anon, authenticated;
