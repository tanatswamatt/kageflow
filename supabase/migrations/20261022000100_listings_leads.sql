-- Kageflow 0013: adverts, stock feeds for portals, and leads from email and WhatsApp
-- (lead source values autotrader, cars_co_za, facebook, email, walk_in were added in their own migration first)
-- * Every vehicle gets a stock number (STK-000001) that buyers quote in enquiries
-- * Published vehicles appear in each company's secret stock feed URLs (JSON, XML, CSV)
-- * Selling or writing off a vehicle unpublishes it automatically
-- * Portal enquiry emails and WhatsApp messages become leads, matched to the vehicle and to an existing open lead

-- ---------- adverts on vehicles ----------
alter table public.inventory_units
  add column stock_no text,
  add column is_published boolean not null default false,
  add column published_at timestamptz,
  add column advert_title text,
  add column advert_description text,
  add column advert_price numeric(18, 2) check (advert_price >= 0),
  add column features text[] not null default '{}',
  add column transmission text,
  add column fuel_type text,
  add column body_type text;

do $$
declare
  r record;
begin
  perform set_config('kageflow.system', 'on', true);
  for r in select id, company_id from public.inventory_units where stock_no is null order by created_at, id loop
    update public.inventory_units set stock_no = private.next_doc_number(r.company_id, 'stock_no', 'STK') where id = r.id;
  end loop;
  perform set_config('kageflow.system', 'off', true);
end $$;
create unique index inventory_units_stock_no_idx on public.inventory_units (company_id, stock_no);

create function private.unit_listing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stock_no is null then
    new.stock_no := private.next_doc_number(new.company_id, 'stock_no', 'STK');
  end if;
  if new.status in ('sold', 'written_off') then
    new.is_published := false;
  end if;
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    new.published_at := now();
  end if;
  return new;
end $$;
create trigger inventory_units_listing before insert or update on public.inventory_units
  for each row execute function private.unit_listing();

-- ---------- photos ----------
create table public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid not null,
  url text not null check (url ~ '^https://'),
  storage_path text,
  position int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id) on delete cascade
);
create index vehicle_photos_unit_idx on public.vehicle_photos (unit_id, position);

-- the first photo becomes the vehicle's main picture
create function private.vehicle_main_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_unit uuid := coalesce(new.unit_id, old.unit_id);
  v_url text;
begin
  select url into v_url from public.vehicle_photos where unit_id = v_unit order by position, created_at limit 1;
  perform set_config('kageflow.system', 'on', true);
  update public.inventory_units set image_url = coalesce(v_url, case when external_id is not null then image_url end) where id = v_unit;
  perform set_config('kageflow.system', 'off', true);
  return null;
end $$;
create trigger vehicle_photos_main after insert or update or delete on public.vehicle_photos
  for each row execute function private.vehicle_main_photo();

alter table public.vehicle_photos enable row level security;
create policy vehicle_photos_select on public.vehicle_photos for select to authenticated using (private.is_member(company_id));
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_photos_update on public.vehicle_photos for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_photos_remove on public.vehicle_photos for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
revoke all on public.vehicle_photos from anon;

-- public bucket; files live under <company_id>/<unit_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function private.storage_company(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy vehicle_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos'
              and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_photos_replace on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos'
         and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy vehicle_photos_drop on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos'
         and private.has_role(private.storage_company(name), array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));

-- ---------- stock feeds ----------
create table public.listing_feeds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel text not null check (channel in ('autotrader', 'cars_co_za', 'facebook', 'website', 'other')),
  name text not null check (length(trim(name)) > 0),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  include_reserved boolean not null default true,
  is_active boolean not null default true,
  last_fetched_at timestamptz,
  fetch_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
alter table public.listing_feeds enable row level security;
create policy listing_feeds_select on public.listing_feeds for select to authenticated using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy listing_feeds_insert on public.listing_feeds for insert to authenticated with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy listing_feeds_update on public.listing_feeds for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[])) with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy listing_feeds_remove on public.listing_feeds for delete to authenticated using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
revoke all on public.listing_feeds from anon;

-- What a portal or website reads. No costs, no customer data.
create function public.stock_feed(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.listing_feeds;
  c public.companies;
  v jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then return null; end if;
  select * into f from public.listing_feeds where token = p_token and is_active;
  if f.id is null then return null; end if;
  update public.listing_feeds set last_fetched_at = now(), fetch_count = fetch_count + 1 where id = f.id;
  select * into c from public.companies where id = f.company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'stock_no', u.stock_no,
      'vin', case when u.vin_confirmed then u.serial_no end,
      'make', u.make, 'model', u.model, 'variant', u.variant, 'year', u.year,
      'mileage_km', u.mileage_km, 'colour', u.colour,
      'transmission', u.transmission, 'fuel_type', u.fuel_type, 'body_type', u.body_type,
      'condition', case when u.is_second_hand then 'used' else 'new' end,
      'price', coalesce(u.advert_price, u.list_price), 'currency', u.list_currency,
      'status', case when u.status = 'reserved' then 'reserved' else 'available' end,
      'title', coalesce(nullif(trim(u.advert_title), ''), concat_ws(' ', u.year, u.make, u.model, u.variant)),
      'description', u.advert_description,
      'features', to_jsonb(u.features),
      'location', u.location,
      'photos', coalesce((select jsonb_agg(p.url order by p.position, p.created_at) from public.vehicle_photos p where p.unit_id = u.id),
                         case when u.image_url is not null then jsonb_build_array(u.image_url) else '[]'::jsonb end),
      'listed_at', u.published_at, 'updated_at', u.updated_at)
      order by u.published_at desc nulls last), '[]'::jsonb)
    into v
    from public.inventory_units u
   where u.company_id = f.company_id and u.is_published
     and (u.status = 'in_stock' or (f.include_reserved and u.status = 'reserved'));
  return jsonb_build_object(
    'dealer', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address),
    'channel', f.channel, 'generated_at', now(), 'count', jsonb_array_length(v), 'vehicles', v);
end $$;
revoke all on function public.stock_feed(text) from public;
grant execute on function public.stock_feed(text) to anon, authenticated;

-- ---------- lead channels (email forwarding, WhatsApp) ----------
create table public.lead_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('email', 'whatsapp')),
  name text not null check (length(trim(name)) > 0),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  phone_number_id text,
  display_phone text,
  verify_token text default encode(extensions.gen_random_bytes(12), 'hex'),
  app_secret text,
  access_token text,
  last_received_at timestamptz,
  received_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
alter table public.lead_channels enable row level security;
create policy lead_channels_select on public.lead_channels for select to authenticated using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy lead_channels_insert on public.lead_channels for insert to authenticated with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy lead_channels_update on public.lead_channels for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[])) with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy lead_channels_remove on public.lead_channels for delete to authenticated using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
revoke all on public.lead_channels from anon;

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel_id uuid,
  lead_id uuid,
  direction text not null check (direction in ('in', 'out')),
  wa_id text not null,
  body text,
  msg_type text not null default 'text',
  wa_message_id text,
  status text,
  sent_by uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, channel_id) references public.lead_channels (company_id, id) on delete set null (channel_id),
  foreign key (company_id, lead_id) references public.crm_leads (company_id, id) on delete set null (lead_id)
);
create unique index whatsapp_messages_wamid_idx on public.whatsapp_messages (wa_message_id) where wa_message_id is not null;
create index whatsapp_messages_lead_idx on public.whatsapp_messages (company_id, lead_id, created_at);
create index whatsapp_messages_wa_idx on public.whatsapp_messages (company_id, wa_id, created_at desc);
alter table public.whatsapp_messages enable row level security;
create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated using (private.is_member(company_id));
revoke all on public.whatsapp_messages from anon;
revoke insert, update on public.whatsapp_messages from authenticated;

-- ---------- capturing a lead ----------
create function private.phone_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null or length(d) < 9 then null
    when d like '0%' and length(d) = 10 then '27' || substr(d, 2)
    else d end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x;
$$;

-- Finds the vehicle mentioned (stock number or VIN), reuses an open lead from the same person, logs the enquiry.
create function private.capture_lead(
  p_company uuid, p_source public.crm_lead_source, p_detail text,
  p_first text, p_last text, p_email text, p_phone text,
  p_subject text, p_message text, p_activity public.crm_activity_type,
  p_external_ref text default null, p_log boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_text text := coalesce(p_subject, '') || ' ' || coalesce(p_message, '');
  v_stock text := upper((regexp_match(v_text, '(STK-?\d{4,6})', 'i'))[1]);
  v_vin text := upper((regexp_match(v_text, '\m([A-HJ-NPR-Z0-9]{17})\M', 'i'))[1]);
  u public.inventory_units;
  v_lead uuid;
  v_created boolean := false;
  v_phone text := private.phone_key(p_phone);
  v_email text := lower(nullif(trim(p_email), ''));
  v_interest text;
begin
  if p_external_ref is not null then
    select id into v_lead from public.crm_leads where company_id = p_company and external_ref = p_external_ref;
    if v_lead is not null then
      return jsonb_build_object('lead_id', v_lead, 'created', false, 'duplicate', true);
    end if;
  end if;
  if v_stock is not null then
    if v_stock !~ '-' then v_stock := 'STK-' || lpad(substr(v_stock, 4), 6, '0'); else v_stock := 'STK-' || lpad(split_part(v_stock, '-', 2), 6, '0'); end if;
    select * into u from public.inventory_units where company_id = p_company and stock_no = v_stock;
  end if;
  if u.id is null and v_vin is not null then
    select * into u from public.inventory_units where company_id = p_company and upper(serial_no) = v_vin;
  end if;
  if u.id is not null then
    v_interest := concat_ws(' ', u.year, u.make, u.model, u.variant) || ' (' || u.stock_no || ')';
  end if;

  select id into v_lead from public.crm_leads
   where company_id = p_company and status not in ('converted', 'disqualified') and created_at > now() - interval '90 days'
     and ((v_phone is not null and private.phone_key(phone) = v_phone) or (v_email is not null and lower(email) = v_email))
   order by created_at desc limit 1;

  if v_lead is null then
    insert into public.crm_leads (company_id, first_name, last_name, email, phone, source, source_detail, interest, estimated_value, currency, notes, external_ref, owner_id)
    values (p_company,
            left(coalesce(nullif(trim(p_first), ''), case when nullif(trim(p_last), '') is null then coalesce(nullif(trim(p_phone), ''), v_email, 'Unknown') end), 100),
            left(nullif(trim(p_last), ''), 100), left(v_email, 200), left(nullif(trim(p_phone), ''), 50),
            p_source, left(p_detail, 200), left(v_interest, 500),
            case when u.id is not null then coalesce(u.advert_price, u.list_price) end,
            case when u.id is not null then u.list_currency else 'ZAR' end,
            left(nullif(trim(p_message), ''), 4000), p_external_ref, null)
    returning id into v_lead;
    v_created := true;
  else
    update public.crm_leads
       set interest = coalesce(interest, left(v_interest, 500)),
           email = coalesce(email, left(v_email, 200)),
           phone = coalesce(phone, left(nullif(trim(p_phone), ''), 50))
     where id = v_lead;
  end if;

  if p_log or v_created then
    insert into public.crm_activities (company_id, type, subject, body, lead_id, owner_id, created_by, completed_at)
    values (p_company, p_activity,
            left(coalesce(nullif(trim(p_subject), ''), 'Enquiry via ' || p_detail) || case when u.id is not null and coalesce(p_subject, '') !~* u.stock_no then ' · ' || u.stock_no else '' end, 300),
            left(nullif(trim(p_message), ''), 8000), v_lead, null, null, now());
  end if;

  if v_created then
    perform private.emit_event(p_company, 'lead.created', jsonb_build_object(
      'id', v_lead, 'source', p_source, 'source_detail', p_detail, 'stock_no', u.stock_no,
      'first_name', p_first, 'last_name', p_last, 'email', v_email, 'phone', p_phone));
  end if;
  return jsonb_build_object('lead_id', v_lead, 'created', v_created, 'unit_id', u.id, 'stock_no', u.stock_no);
end $$;

-- Portal enquiry emails, forwarded by an inbound email service to /api/inbound/email/<token>
-- p_lead: {source, source_detail, first_name, last_name, email, phone, subject, message, message_id}
create function public.inbound_email_lead(p_token text, p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ch public.lead_channels;
  v_source public.crm_lead_source;
  r jsonb;
begin
  select * into ch from public.lead_channels where token = p_token and kind = 'email' and is_active and length(p_token) >= 32;
  if ch.id is null then raise exception 'Unknown lead address' using errcode = '28000'; end if;
  if coalesce(nullif(trim(p_lead ->> 'first_name'), ''), nullif(trim(p_lead ->> 'last_name'), ''), nullif(trim(p_lead ->> 'email'), ''), nullif(trim(p_lead ->> 'phone'), '')) is null then
    raise exception 'No name, email or phone found in the message' using errcode = '22023';
  end if;
  begin
    v_source := coalesce(nullif(p_lead ->> 'source', ''), 'email')::public.crm_lead_source;
  exception when others then
    v_source := 'email';
  end;
  r := private.capture_lead(ch.company_id, v_source, coalesce(nullif(p_lead ->> 'source_detail', ''), 'Email'),
        p_lead ->> 'first_name', p_lead ->> 'last_name', p_lead ->> 'email', p_lead ->> 'phone',
        p_lead ->> 'subject', p_lead ->> 'message', 'email', nullif(trim(p_lead ->> 'message_id'), ''), true);
  update public.lead_channels set last_received_at = now(), received_count = received_count + 1 where id = ch.id;
  return r;
end $$;

create function public.whatsapp_verify(p_token text, p_verify text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lead_channels where token = p_token and kind = 'whatsapp' and is_active and verify_token = p_verify and length(p_token) >= 32);
$$;

-- WhatsApp Cloud API webhook. The signature is checked here so the app secret never leaves the database.
create function public.whatsapp_inbound(p_token text, p_raw text, p_signature text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ch public.lead_channels;
  v jsonb;
  ent jsonb; chg jsonb; m jsonb; st jsonb; ct jsonb;
  v_name text; v_body text; v_n int := 0;
  v_lead jsonb; v_recent boolean; v_msg uuid;
begin
  select * into ch from public.lead_channels where token = p_token and kind = 'whatsapp' and is_active and length(p_token) >= 32;
  if ch.id is null then raise exception 'Unknown WhatsApp channel' using errcode = '28000'; end if;
  if ch.app_secret is not null and coalesce(p_signature, '') <> 'sha256=' || encode(extensions.hmac(p_raw, ch.app_secret, 'sha256'), 'hex') then
    raise exception 'Bad signature' using errcode = '28000';
  end if;
  v := p_raw::jsonb;
  for ent in select * from jsonb_array_elements(coalesce(v -> 'entry', '[]'::jsonb)) loop
    for chg in select * from jsonb_array_elements(coalesce(ent -> 'changes', '[]'::jsonb)) loop
      if ch.phone_number_id is not null and coalesce(chg -> 'value' -> 'metadata' ->> 'phone_number_id', ch.phone_number_id) <> ch.phone_number_id then
        continue;
      end if;
      -- delivery receipts for messages we sent
      for st in select * from jsonb_array_elements(coalesce(chg -> 'value' -> 'statuses', '[]'::jsonb)) loop
        update public.whatsapp_messages set status = st ->> 'status' where wa_message_id = st ->> 'id' and company_id = ch.company_id;
      end loop;
      for m in select * from jsonb_array_elements(coalesce(chg -> 'value' -> 'messages', '[]'::jsonb)) loop
        v_name := null;
        for ct in select * from jsonb_array_elements(coalesce(chg -> 'value' -> 'contacts', '[]'::jsonb)) loop
          if ct ->> 'wa_id' = m ->> 'from' then v_name := ct -> 'profile' ->> 'name'; end if;
        end loop;
        v_body := coalesce(m -> 'text' ->> 'body', m -> 'button' ->> 'text', m -> 'interactive' -> 'button_reply' ->> 'title',
                           m -> 'interactive' -> 'list_reply' ->> 'title', m -> 'image' ->> 'caption', m -> 'document' ->> 'caption',
                           '[' || coalesce(m ->> 'type', 'message') || ']');
        insert into public.whatsapp_messages (company_id, channel_id, direction, wa_id, body, msg_type, wa_message_id, status)
        values (ch.company_id, ch.id, 'in', m ->> 'from', left(v_body, 4000), coalesce(m ->> 'type', 'text'), m ->> 'id', 'received')
        on conflict (wa_message_id) where wa_message_id is not null do nothing
        returning id into v_msg;
        continue when v_msg is null;   -- already received (Meta retries)
        select exists (select 1 from public.whatsapp_messages w where w.company_id = ch.company_id and w.wa_id = m ->> 'from'
                        and w.direction = 'in' and w.id <> v_msg and w.created_at > now() - interval '12 hours') into v_recent;
        v_lead := private.capture_lead(ch.company_id, 'whatsapp', 'WhatsApp ' || coalesce(ch.display_phone, ''),
                    split_part(coalesce(v_name, ''), ' ', 1), nullif(substr(coalesce(v_name, ''), length(split_part(coalesce(v_name, ''), ' ', 1)) + 2), ''),
                    null, '+' || (m ->> 'from'), 'WhatsApp from ' || coalesce(v_name, '+' || (m ->> 'from')), v_body, 'whatsapp', null, not v_recent);
        update public.whatsapp_messages set lead_id = (v_lead ->> 'lead_id')::uuid where id = v_msg;
        v_n := v_n + 1;
        v_msg := null;
      end loop;
    end loop;
  end loop;
  if v_n > 0 then
    update public.lead_channels set last_received_at = now(), received_count = received_count + v_n where id = ch.id;
  end if;
  return v_n;
end $$;

-- For sending a reply: only on the server, only for people who work leads
create function public.whatsapp_send_context(p_lead uuid)
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
  return jsonb_build_object('channel_id', ch.id, 'phone_number_id', ch.phone_number_id, 'access_token', ch.access_token, 'to', v_to,
    'last_inbound', (select max(w.created_at) from public.whatsapp_messages w where w.lead_id = l.id and w.direction = 'in'));
end $$;

create function public.whatsapp_log_outbound(p_lead uuid, p_channel uuid, p_to text, p_body text, p_wa_message_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.crm_leads;
  v_id uuid;
begin
  select * into l from public.crm_leads where id = p_lead;
  if l.id is null or not private.has_role(l.company_id, array['owner', 'admin', 'sales']::public.member_role[]) then
    raise exception 'Lead not found or your role can''t message leads';
  end if;
  insert into public.whatsapp_messages (company_id, channel_id, lead_id, direction, wa_id, body, wa_message_id, status, sent_by)
  values (l.company_id, p_channel, l.id, 'out', p_to, left(p_body, 4000), p_wa_message_id, 'sent', auth.uid())
  returning id into v_id;
  if l.status = 'new' then
    update public.crm_leads set status = 'contacted' where id = l.id;
  end if;
  return v_id;
end $$;

revoke all on function private.capture_lead(uuid, public.crm_lead_source, text, text, text, text, text, text, text, public.crm_activity_type, text, boolean) from public;
revoke all on function public.inbound_email_lead(text, jsonb) from public;
revoke all on function public.whatsapp_verify(text, text) from public;
revoke all on function public.whatsapp_inbound(text, text, text) from public;
revoke all on function public.whatsapp_send_context(uuid) from public, anon;
revoke all on function public.whatsapp_log_outbound(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.inbound_email_lead(text, jsonb) to anon, authenticated;
grant execute on function public.whatsapp_verify(text, text) to anon, authenticated;
grant execute on function public.whatsapp_inbound(text, text, text) to anon, authenticated;
grant execute on function public.whatsapp_send_context(uuid) to authenticated;
grant execute on function public.whatsapp_log_outbound(uuid, uuid, text, text, text) to authenticated;

-- ---------- audit: keep channel secrets and feed tokens out of the log ----------
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - 'secret' - 'key_hash' - 'share_token' - 'api_key' - 'token' - 'app_secret' - 'access_token' - 'verify_token'; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new) - 'secret' - 'key_hash' - 'share_token' - 'api_key' - 'token' - 'app_secret' - 'access_token' - 'verify_token'; end if;
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

create trigger audit_listing_feeds after insert or update or delete on public.listing_feeds for each row execute function private.audit_row();
create trigger audit_lead_channels after insert or update or delete on public.lead_channels for each row execute function private.audit_row();
create trigger audit_vehicle_photos after insert or update or delete on public.vehicle_photos for each row execute function private.audit_row();
