-- WhatsApp, part two: inbox, templates, photos and documents, sending cars, and the access token kept server-side.

alter table public.lead_channels add column waba_id text check (waba_id is null or waba_id ~ '^\d{6,25}$');

alter table public.whatsapp_messages
  add column media_id text,
  add column media_mime text,
  add column media_name text,
  add column media_link text,
  add column template_name text,
  add column error text;

-- Approved message templates, read from Meta. Needed to start a conversation or reply after 24 hours.
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel_id uuid not null references public.lead_channels (id) on delete cascade,
  name text not null,
  language text not null,
  category text,
  status text not null,
  body text not null,
  params text[] not null default '{}',     -- placeholders in the body, in order: '1','2' or named
  usable boolean not null default true,    -- false when it needs header media or button values Kageflow can't fill yet
  updated_at timestamptz not null default now(),
  unique (channel_id, name, language)
);
alter table public.whatsapp_templates enable row level security;
create policy whatsapp_templates_select on public.whatsapp_templates for select to authenticated using (private.is_member(company_id));

-- The send context no longer hands the access token to the browser-facing API: the server reads it with its own key.
create or replace function public.whatsapp_send_context(p_lead uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.crm_leads;
  ch public.lead_channels;
  v_to text;
begin
  select * into l from public.crm_leads where id = p_lead;
  if l.id is null or not private.has_role(l.company_id, array['owner', 'admin', 'sales']::public.member_role[]) then
    raise exception 'Lead not found or your role can''t message leads';
  end if;
  select w.wa_id into v_to from public.whatsapp_messages w where w.lead_id = l.id order by w.created_at desc limit 1;
  v_to := coalesce(v_to, private.phone_key(l.phone));
  if v_to is null then raise exception 'This lead has no phone number'; end if;
  select c.* into ch from public.lead_channels c
   where c.company_id = l.company_id and c.kind = 'whatsapp' and c.is_active and c.access_token is not null and c.phone_number_id is not null
   order by (c.id = (select w.channel_id from public.whatsapp_messages w where w.lead_id = l.id and w.channel_id is not null order by w.created_at desc limit 1)) desc nulls last, c.created_at
   limit 1;
  if ch.id is null then raise exception 'Connect WhatsApp under Settings, Listings and leads first'; end if;
  return jsonb_build_object('channel_id', ch.id, 'phone_number_id', ch.phone_number_id, 'to', v_to, 'company_id', l.company_id,
    'first_name', l.first_name, 'unit_id', l.unit_id,
    'last_inbound', (select max(w.created_at) from public.whatsapp_messages w where w.lead_id = l.id and w.direction = 'in'));
end $$;

create or replace function public.whatsapp_log_sent(p_lead uuid, p_channel uuid, p_to text, p_body text, p_wa_message_id text,
                                                    p_type text default 'text', p_template text default null, p_media_link text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.crm_leads;
  v_id uuid;
begin
  select * into l from public.crm_leads where id = p_lead;
  if l.id is null or not private.has_role(l.company_id, array['owner', 'admin', 'sales']::public.member_role[]) then
    raise exception 'Lead not found or your role can''t message leads';
  end if;
  if not exists (select 1 from public.lead_channels c where c.id = p_channel and c.company_id = l.company_id) then
    raise exception 'Unknown WhatsApp channel';
  end if;
  insert into public.whatsapp_messages (company_id, channel_id, lead_id, direction, wa_id, body, msg_type, wa_message_id, status, sent_by, template_name, media_link)
  values (l.company_id, p_channel, l.id, 'out', p_to, left(p_body, 4000), coalesce(p_type, 'text'), p_wa_message_id, 'sent', auth.uid(), p_template, p_media_link)
  returning id into v_id;
  if l.status = 'new' then
    update public.crm_leads set status = 'contacted' where id = l.id;
  end if;
  return v_id;
end $$;
revoke all on function public.whatsapp_log_sent(uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.whatsapp_log_sent(uuid, uuid, text, text, text, text, text, text) to authenticated;

-- Inbox: one row per conversation (lead), newest first. Runs as the caller, so row-level security applies.
create or replace function public.whatsapp_conversations(p_company uuid, p_limit integer default 100)
returns table (lead_id uuid, name text, wa_id text, last_body text, last_at timestamptz, last_direction text,
               unread integer, last_inbound timestamptz, owner_id uuid, lead_status text, unit_id uuid)
language sql stable set search_path = '' as $$
  with last_msg as (
    select distinct on (w.lead_id) w.lead_id, w.wa_id, w.body, w.created_at, w.direction
      from public.whatsapp_messages w
     where w.company_id = p_company and w.lead_id is not null
     order by w.lead_id, w.created_at desc
  ), stats as (
    select w.lead_id,
           max(w.created_at) filter (where w.direction = 'in') as last_in,
           max(w.created_at) filter (where w.direction = 'out') as last_out
      from public.whatsapp_messages w
     where w.company_id = p_company and w.lead_id is not null
     group by w.lead_id
  )
  select m.lead_id,
         coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company_name, '+' || m.wa_id),
         m.wa_id, m.body, m.created_at, m.direction,
         (select count(*)::int from public.whatsapp_messages x
           where x.lead_id = m.lead_id and x.direction = 'in' and x.created_at > coalesce(s.last_out, '-infinity'::timestamptz)),
         s.last_in, l.owner_id, l.status::text, l.unit_id
    from last_msg m
    join stats s on s.lead_id = m.lead_id
    join public.crm_leads l on l.id = m.lead_id
   order by m.created_at desc
   limit greatest(1, least(p_limit, 500));
$$;
revoke all on function public.whatsapp_conversations(uuid, integer) from public, anon;
grant execute on function public.whatsapp_conversations(uuid, integer) to authenticated;

-- Conversations waiting for a reply (for the menu badge)
create or replace function public.whatsapp_waiting(p_company uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::int from (
    select w.lead_id
      from public.whatsapp_messages w
     where w.company_id = p_company and w.lead_id is not null and w.created_at > now() - interval '7 days'
     group by w.lead_id
    having max(w.created_at) filter (where w.direction = 'in') > coalesce(max(w.created_at) filter (where w.direction = 'out'), '-infinity'::timestamptz)
  ) t;
$$;
revoke all on function public.whatsapp_waiting(uuid) from public, anon;
grant execute on function public.whatsapp_waiting(uuid) to authenticated;

-- Inbound: keep the media id (photos, voice notes, documents) and delivery errors
do $$
declare
  v_def text := pg_get_functiondef('public.whatsapp_inbound(text, text, text)'::regprocedure);
  a1 text := 'update public.whatsapp_messages set status = st ->> ''status'' where wa_message_id = st ->> ''id'' and company_id = ch.company_id;';
  b1 text := 'update public.whatsapp_messages set status = st ->> ''status'', error = coalesce(st -> ''errors'' -> 0 ->> ''title'', error) where wa_message_id = st ->> ''id'' and company_id = ch.company_id;';
  a2 text := 'insert into public.whatsapp_messages (company_id, channel_id, direction, wa_id, body, msg_type, wa_message_id, status)
        values (ch.company_id, ch.id, ''in'', m ->> ''from'', left(v_body, 4000), coalesce(m ->> ''type'', ''text''), m ->> ''id'', ''received'')';
  b2 text := 'insert into public.whatsapp_messages (company_id, channel_id, direction, wa_id, body, msg_type, wa_message_id, status, media_id, media_mime, media_name)
        values (ch.company_id, ch.id, ''in'', m ->> ''from'', left(v_body, 4000), coalesce(m ->> ''type'', ''text''), m ->> ''id'', ''received'',
                m -> (m ->> ''type'') ->> ''id'', m -> (m ->> ''type'') ->> ''mime_type'', left(m -> ''document'' ->> ''filename'', 200))';
begin
  if position(a1 in v_def) = 0 then raise exception 'whatsapp_inbound: status anchor not found'; end if;
  if position(a2 in v_def) = 0 then raise exception 'whatsapp_inbound: insert anchor not found'; end if;
  v_def := replace(replace(v_def, a1, b1), a2, b2);
  execute v_def;
end $$;
