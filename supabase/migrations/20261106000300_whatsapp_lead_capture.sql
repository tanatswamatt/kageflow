-- WhatsApp lead capture: an instant welcome reply and fair assignment of new WhatsApp leads to the sales team.

alter table public.lead_channels
  add column auto_reply text check (auto_reply is null or length(auto_reply) <= 1000),
  add column assign_mode text not null default 'none' check (assign_mode in ('none', 'round_robin'));

create or replace function private.whatsapp_after_new_lead(p_channel uuid, p_lead uuid, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ch public.lead_channels;
  l public.crm_leads;
  v_owner uuid;
  v_body text;
begin
  select * into ch from public.lead_channels where id = p_channel;
  select * into l from public.crm_leads where id = p_lead;
  if ch.id is null or l.id is null then return; end if;

  -- round robin: the salesperson with the fewest open leads from the last 30 days (owners and admins if there's no sales team)
  if ch.assign_mode = 'round_robin' and l.owner_id is null then
    select m.user_id into v_owner
      from public.company_members m
     where m.company_id = ch.company_id
       and m.role = case when exists (select 1 from public.company_members s where s.company_id = ch.company_id and s.role = 'sales') then 'sales'::public.member_role else m.role end
       and m.role in ('sales', 'owner', 'admin')
     order by (select count(*) from public.crm_leads x where x.company_id = ch.company_id and x.owner_id = m.user_id
                and x.status in ('new', 'contacted', 'qualified') and x.created_at > now() - interval '30 days'), random()
     limit 1;
    if v_owner is not null then update public.crm_leads set owner_id = v_owner where id = l.id; end if;
  end if;

  -- welcome reply: free, because they have just messaged
  if nullif(trim(coalesce(ch.auto_reply, '')), '') is not null and ch.access_token is not null and ch.phone_number_id is not null then
    v_body := replace(replace(ch.auto_reply, '{name}', coalesce(nullif(trim(l.first_name), ''), 'there')), '{car}', coalesce(l.interest, 'the car'));
    begin
      perform net.http_post(
        url := 'https://graph.facebook.com/v21.0/' || ch.phone_number_id || '/messages',
        body := jsonb_build_object('messaging_product', 'whatsapp', 'recipient_type', 'individual', 'to', p_to, 'type', 'text', 'text', jsonb_build_object('body', v_body)),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || ch.access_token),
        timeout_milliseconds := 10000);
      insert into public.whatsapp_messages (company_id, channel_id, lead_id, direction, wa_id, body, msg_type, status, template_name)
      values (ch.company_id, ch.id, l.id, 'out', p_to, left(v_body, 4000), 'text', 'sent', 'auto-reply');
    exception when others then
      null; -- a failed welcome must never lose the lead
    end;
  end if;
end $$;
revoke all on function private.whatsapp_after_new_lead(uuid, uuid, text) from public;

do $$
declare
  v_def text := pg_get_functiondef('public.whatsapp_inbound(text, text, text)'::regprocedure);
  a text := 'update public.whatsapp_messages set lead_id = (v_lead ->> ''lead_id'')::uuid where id = v_msg;';
begin
  if position(a in v_def) = 0 then raise exception 'whatsapp_inbound: lead anchor not found'; end if;
  v_def := replace(v_def, a, a || '
        if coalesce((v_lead ->> ''created'')::boolean, false) then
          perform private.whatsapp_after_new_lead(ch.id, (v_lead ->> ''lead_id'')::uuid, m ->> ''from'');
        end if;');
  execute v_def;
end $$;

-- Sales staff can't read channel settings, but need to know whether WhatsApp is connected
create or replace function public.whatsapp_connected(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_company) and exists (
    select 1 from public.lead_channels c
     where c.company_id = p_company and c.kind = 'whatsapp' and c.is_active and c.access_token is not null and c.phone_number_id is not null);
$$;
revoke all on function public.whatsapp_connected(uuid) from public, anon;
grant execute on function public.whatsapp_connected(uuid) to authenticated;
