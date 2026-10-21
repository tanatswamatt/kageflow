-- Kageflow 0001: tenancy — companies, members, profiles, role helpers
-- Every business table carries company_id; RLS uses private.is_member / private.has_role.

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.member_role as enum ('owner', 'admin', 'accountant', 'sales', 'viewer');

-- Profiles mirror auth.users so members can see each other's names
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  legal_name text,
  registration_no text,
  vat_no text,
  base_currency char(3) not null default 'ZAR' check (base_currency ~ '^[A-Z]{3}$'),
  country char(2) not null default 'ZA',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

-- ---------- helpers ----------
create function private.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(p_company uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.member_role[]) from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;

create trigger companies_touch before update on public.companies
  for each row execute function private.touch_updated_at();

-- New auth user -> profile
create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.company_members a
      join public.company_members b on a.company_id = b.company_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy companies_select on public.companies for select to authenticated
  using (private.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (private.has_role(id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(id, array['owner', 'admin']::public.member_role[]));

create policy members_select on public.company_members for select to authenticated
  using (private.is_member(company_id));
-- membership changes go through the RPCs below only

revoke all on public.profiles, public.companies, public.company_members from anon;
revoke insert on public.companies from authenticated;
revoke insert, update on public.company_members from authenticated;
revoke insert on public.profiles from authenticated;

-- Seed hook, redefined by later migrations
create function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

-- ---------- membership RPCs ----------
create function public.create_company(
  p_name text,
  p_legal_name text default null,
  p_registration_no text default null,
  p_vat_no text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;
  insert into public.companies (name, legal_name, registration_no, vat_no, created_by)
  values (trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_registration_no), ''), nullif(trim(p_vat_no), ''), v_uid)
  returning id into v_id;
  insert into public.company_members (company_id, user_id, role) values (v_id, v_uid, 'owner');
  perform private.seed_company(v_id);
  return v_id;
end $$;

create function public.add_member_by_email(p_company uuid, p_email text, p_role public.member_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can add members';
  end if;
  if p_role = 'owner' and not private.has_role(p_company, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can add another owner';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No Kageflow user with that email. Ask them to sign up first.';
  end if;
  insert into public.company_members (company_id, user_id, role)
  values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do nothing;
  return v_user;
end $$;

create function public.set_member_role(p_company uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current public.member_role;
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can change roles';
  end if;
  select role into v_current from public.company_members where company_id = p_company and user_id = p_user;
  if v_current is null then
    raise exception 'Not a member of this company';
  end if;
  if (v_current = 'owner' or p_role = 'owner')
     and not private.has_role(p_company, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can grant or remove owner access';
  end if;
  if v_current = 'owner' and p_role <> 'owner'
     and (select count(*) from public.company_members where company_id = p_company and role = 'owner') = 1 then
    raise exception 'A company needs at least one owner';
  end if;
  update public.company_members set role = p_role where company_id = p_company and user_id = p_user;
end $$;


revoke all on function public.create_company(text, text, text, text) from public, anon;
revoke all on function public.add_member_by_email(uuid, text, public.member_role) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public, anon;
grant execute on function public.create_company(text, text, text, text) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.member_role) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated;
