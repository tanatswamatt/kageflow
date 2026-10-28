-- Kageflow 0021: team invitations by email
create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  token_hash text not null unique,
  invited_by uuid not null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  unique (company_id, id)
);
create index company_invitations_company_idx on public.company_invitations (company_id, created_at desc);
create index company_invitations_email_idx on public.company_invitations (email) where accepted_at is null and revoked_at is null;

alter table public.company_invitations enable row level security;
create policy company_invitations_select on public.company_invitations for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
revoke all on public.company_invitations from anon;
revoke insert, update, delete, truncate, trigger, references on public.company_invitations from authenticated;
create trigger audit_company_invitations after insert or update or delete on public.company_invitations for each row execute function private.audit_row();

-- owner or admin invites someone; returns the one-time token (only its hash is stored)
create function public.create_invitation(p_company uuid, p_email text, p_role public.member_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  c public.companies;
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can invite people';
  end if;
  if p_role = 'owner' and not private.has_role(p_company, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can invite another owner';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from public.company_members m join auth.users u on u.id = m.user_id
              where m.company_id = p_company and lower(u.email) = v_email) then
    raise exception 'That person is already in this team';
  end if;
  if (select count(*) from public.company_invitations where company_id = p_company and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many invitations today. Try again tomorrow';
  end if;
  -- a new invitation replaces any earlier one still waiting for the same email
  update public.company_invitations set revoked_at = now()
   where company_id = p_company and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.company_invitations (company_id, email, role, token_hash)
  values (p_company, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  select * into c from public.companies where id = p_company;
  return jsonb_build_object('id', v_id, 'token', v_token, 'company', c.name, 'email', v_email, 'role', p_role,
    'inviter', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()),
    'inviter_email', (select email from auth.users where id = auth.uid()));
end $$;

create function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.company_invitations;
begin
  select * into i from public.company_invitations where id = p_id;
  if i.id is null or not private.has_role(i.company_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Invitation not found';
  end if;
  update public.company_invitations set revoked_at = now() where id = p_id and accepted_at is null and revoked_at is null;
end $$;

-- what the join page shows; the token itself is the secret, so it may say who it is for
create function public.invitation_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.company_invitations;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into i from public.company_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if i.id is null then return jsonb_build_object('status', 'invalid'); end if;
  return jsonb_build_object(
    'status', case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
                   when i.expires_at < now() then 'expired' else 'valid' end,
    'company', (select name from public.companies where id = i.company_id),
    'email', i.email, 'role', i.role,
    'inviter', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = i.invited_by),
    'has_account', exists (select 1 from auth.users where lower(email) = i.email));
end $$;

create function private.accept_invitation_row(i public.company_invitations)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := (select lower(email) from auth.users where id = auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if i.id is null then raise exception 'This invitation link is not valid'; end if;
  if i.accepted_at is not null then raise exception 'This invitation has already been used'; end if;
  if i.revoked_at is not null then raise exception 'This invitation was cancelled. Ask for a new one'; end if;
  if i.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one'; end if;
  if v_email is distinct from i.email then
    raise exception 'This invitation is for %. Sign in with that email to accept it', i.email;
  end if;
  insert into public.company_members (company_id, user_id, role) values (i.company_id, auth.uid(), i.role)
  on conflict (company_id, user_id) do nothing;
  update public.company_invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.company_id;
end $$;

create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.company_invitations;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'This invitation link is not valid'; end if;
  select * into i from public.company_invitations where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  return private.accept_invitation_row(i);
end $$;

-- invitations waiting for the signed-in person's email (shown on the setup screen)
create function public.my_invitations()
returns table (id uuid, company text, role public.member_role, inviter text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, c.name, i.role, (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = i.invited_by), i.expires_at
    from public.company_invitations i join public.companies c on c.id = i.company_id
   where i.email = (select lower(email) from auth.users where id = auth.uid())
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc;
$$;

create function public.accept_invitation_by_id(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.company_invitations;
begin
  select * into i from public.company_invitations where id = p_id for update;
  return private.accept_invitation_row(i);
end $$;

revoke all on function public.create_invitation(uuid, text, public.member_role), public.revoke_invitation(uuid),
  public.accept_invitation(text), public.my_invitations(), public.accept_invitation_by_id(uuid),
  public.invitation_preview(text) from public, anon;
revoke all on function private.accept_invitation_row(public.company_invitations) from public, anon, authenticated;
grant execute on function public.create_invitation(uuid, text, public.member_role), public.revoke_invitation(uuid),
  public.accept_invitation(text), public.my_invitations(), public.accept_invitation_by_id(uuid) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
