-- Kageflow 0008: API keys, lead intake and order lookup for websites (Kalali), signed outbound webhooks
--
-- Inbound: a website's server calls api_submit_lead / api_order_status with a secret API key.
--          Keys are stored only as SHA-256 hashes; the plain key is shown once when created.
-- Outbound: order.updated, invoice.issued, credit_note.issued and payment.received are POSTed to each
--           subscribed endpoint, signed with HMAC-SHA256 of the raw body in the X-Kageflow-Signature header.

create extension if not exists pg_net;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  prefix text not null,
  key_hash text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_company_idx on public.api_keys (company_id);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  url text not null check (url ~ '^https://[^\s]+$'),
  description text,
  secret text not null default 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex'),
  events text[] not null default array['order.updated', 'invoice.issued', 'credit_note.issued', 'payment.received'],
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index webhook_endpoints_company_idx on public.webhook_endpoints (company_id) where is_active;

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  request_id bigint,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_company_idx on public.webhook_deliveries (company_id, id desc);

-- ---------- API keys ----------
create function public.create_api_key(p_company uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_key text := 'kf_live_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can create API keys';
  end if;
  insert into public.api_keys (company_id, name, prefix, key_hash)
  values (p_company, trim(p_name), left(v_key, 14), encode(extensions.digest(v_key, 'sha256'), 'hex'));
  return v_key;
end $$;

create function public.revoke_api_key(p_key_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.api_keys where id = p_key_id;
  if v_company is null or not private.has_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Key not found, or only owners and admins can revoke keys';
  end if;
  update public.api_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
end $$;

create function private.api_company(p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_company uuid;
begin
  if p_key is null or p_key !~ '^kf_live_[0-9a-f]{48}$' then
    raise exception 'Invalid API key' using errcode = '28000';
  end if;
  select id, company_id into v_id, v_company from public.api_keys
   where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') and revoked_at is null;
  if v_company is null then
    raise exception 'Invalid API key' using errcode = '28000';
  end if;
  update public.api_keys set last_used_at = now() where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return v_company;
end $$;

-- Lead intake. Idempotent on external_ref (send your form submission id).
create function public.api_submit_lead(p_api_key text, p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.api_company(p_api_key);
  v_id uuid;
  v_ref text := nullif(trim(p_lead ->> 'external_ref'), '');
  v_source public.crm_lead_source;
  v_consent boolean := coalesce((p_lead ->> 'consent')::boolean, false);
  v_value numeric;
begin
  if jsonb_typeof(p_lead) <> 'object' then
    raise exception 'Lead must be a JSON object' using errcode = '22023';
  end if;
  if v_ref is not null then
    select id into v_id from public.crm_leads where company_id = v_company and external_ref = v_ref;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'status', 'existing');
    end if;
  end if;
  if coalesce(nullif(trim(p_lead ->> 'first_name'), ''), nullif(trim(p_lead ->> 'last_name'), ''), nullif(trim(p_lead ->> 'company_name'), '')) is null then
    raise exception 'Send first_name, last_name or company_name' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_lead ->> 'email'), ''), nullif(trim(p_lead ->> 'phone'), '')) is null then
    raise exception 'Send an email or phone number' using errcode = '22023';
  end if;
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

  insert into public.crm_leads (company_id, first_name, last_name, company_name, email, phone, source, source_detail,
                                interest, estimated_value, currency, notes, external_ref, owner_id,
                                consent_basis, consent_source, consent_at)
  values (v_company,
          left(nullif(trim(p_lead ->> 'first_name'), ''), 100), left(nullif(trim(p_lead ->> 'last_name'), ''), 100),
          left(nullif(trim(p_lead ->> 'company_name'), ''), 200), left(nullif(trim(p_lead ->> 'email'), ''), 200),
          left(nullif(trim(p_lead ->> 'phone'), ''), 50), v_source, left(coalesce(nullif(trim(p_lead ->> 'source_detail'), ''), 'API'), 200),
          left(nullif(trim(p_lead ->> 'interest'), ''), 500), case when v_value >= 0 then v_value end,
          case when coalesce(p_lead ->> 'currency', '') ~ '^[A-Z]{3}$' then p_lead ->> 'currency' else 'ZAR' end,
          left(nullif(trim(p_lead ->> 'message'), ''), 4000), v_ref, null,
          case when v_consent then 'consent' else 'not_recorded' end::public.consent_basis,
          case when v_consent then left(coalesce(nullif(trim(p_lead ->> 'consent_text'), ''), 'Website form'), 300) end,
          case when v_consent then now() end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'created');
end $$;

-- Order status for a customer-facing tracker. Look up by order number (SO-000001) or your own reference.
create function public.api_order_status(p_api_key text, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.api_company(p_api_key);
  o public.sales_docs;
  inv public.sales_docs;
  v_paid numeric;
begin
  select * into o from public.sales_docs
   where company_id = v_company and doc_type = 'order' and status <> 'draft' and (number = p_ref or reference = p_ref)
   order by created_at desc limit 1;
  if o.id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into inv from public.sales_docs
   where company_id = v_company and doc_type = 'invoice' and status = 'issued' and source_doc_id = o.id
   order by issued_at desc limit 1;
  select coalesce(sum(amount), 0) into v_paid from public.customer_payments
   where order_id = o.id and reversal_journal_id is null;
  return jsonb_build_object(
    'found', true, 'number', o.number, 'reference', o.reference, 'status', o.status, 'tracking_stage', o.tracking_stage,
    'currency', o.currency, 'total', o.total, 'deposits_received', v_paid, 'updated_at', o.updated_at,
    'invoice', case when inv.id is null then null else jsonb_build_object('number', inv.number, 'total', inv.total, 'amount_due', inv.amount_due, 'due_date', inv.due_date) end);
end $$;

-- ---------- outbound webhooks ----------
create or replace function private.emit_event(p_company uuid, p_event text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.webhook_endpoints;
  v_body jsonb;
  v_sig text;
  v_req bigint;
begin
  for e in
    select * from public.webhook_endpoints
     where company_id = p_company and is_active and (p_event = any (events) or p_event = 'ping')
  loop
    v_body := jsonb_build_object('event', p_event, 'company_id', p_company, 'sent_at', now(), 'data', p_data);
    v_sig := encode(extensions.hmac(v_body::text, e.secret, 'sha256'), 'hex');
    begin
      v_req := net.http_post(
        url := e.url,
        body := v_body,
        headers := jsonb_build_object('Content-Type', 'application/json', 'X-Kageflow-Event', p_event, 'X-Kageflow-Signature', 'sha256=' || v_sig),
        timeout_milliseconds := 5000);
    exception when others then
      v_req := null;
    end;
    insert into public.webhook_deliveries (company_id, endpoint_id, event, payload, request_id)
    values (p_company, e.id, p_event, v_body, v_req);
  end loop;
end $$;

create function public.send_test_webhook(p_endpoint uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.webhook_endpoints where id = p_endpoint;
  if v_company is null or not private.has_role(v_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Endpoint not found, or only owners and admins can send tests';
  end if;
  perform private.emit_event(v_company, 'ping', jsonb_build_object('message', 'Test from Kageflow', 'endpoint_id', p_endpoint));
end $$;

-- Delivery log with the HTTP result pg_net recorded (kept by pg_net for a few hours)
create function public.webhook_delivery_log(p_company uuid, p_limit int default 50)
returns table (id bigint, endpoint_id uuid, url text, event text, created_at timestamptz, status_code int, error_msg text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.endpoint_id, e.url, d.event, d.created_at, r.status_code, r.error_msg
    from public.webhook_deliveries d
    join public.webhook_endpoints e on e.id = d.endpoint_id
    left join net._http_response r on r.id = d.request_id
   where d.company_id = p_company and private.has_role(p_company, array['owner', 'admin']::public.member_role[])
   order by d.id desc
   limit least(coalesce(p_limit, 50), 200);
$$;

revoke all on function public.create_api_key(uuid, text) from public, anon;
revoke all on function public.revoke_api_key(uuid) from public, anon;
revoke all on function public.api_submit_lead(text, jsonb) from public;
revoke all on function public.api_order_status(text, text) from public;
revoke all on function public.send_test_webhook(uuid) from public, anon;
revoke all on function public.webhook_delivery_log(uuid, int) from public, anon;
revoke all on function private.api_company(text) from public;
grant execute on function public.create_api_key(uuid, text) to authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;
grant execute on function public.api_submit_lead(text, jsonb) to anon, authenticated;
grant execute on function public.api_order_status(text, text) to anon, authenticated;
grant execute on function public.send_test_webhook(uuid) to authenticated;
grant execute on function public.webhook_delivery_log(uuid, int) to authenticated;

alter table public.api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy api_keys_select on public.api_keys for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy endpoints_select on public.webhook_endpoints for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy endpoints_insert on public.webhook_endpoints for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy endpoints_update on public.webhook_endpoints for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy endpoints_remove on public.webhook_endpoints for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy deliveries_select on public.webhook_deliveries for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

revoke all on public.api_keys, public.webhook_endpoints, public.webhook_deliveries from anon;
revoke insert, update on public.api_keys, public.webhook_deliveries from authenticated;

create trigger audit_api_keys after insert or update or delete on public.api_keys for each row execute function private.audit_row();
create trigger audit_webhook_endpoints after insert or update or delete on public.webhook_endpoints for each row execute function private.audit_row();

-- Keep secrets out of the audit log (accountants can read it)
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - 'secret' - 'key_hash' - 'share_token'; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new) - 'secret' - 'key_hash' - 'share_token'; end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  if tg_table_name = 'companies' then
    v_company := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_company := coalesce(v_new ->> 'company_id', v_old ->> 'company_id')::uuid;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id');
  insert into public.audit_log (company_id, table_name, record_id, action, actor, old_data, new_data)
  values (v_company, tg_table_name, v_id, tg_op, auth.uid(), v_old, v_new);
  return null;
end $$;
