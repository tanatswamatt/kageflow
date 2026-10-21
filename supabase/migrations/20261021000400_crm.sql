-- Kageflow 0004: CRM — pipeline stages, accounts, contacts, leads, deals, activities
-- Read: any member. Write: owner, admin, sales. Remove: owner, admin.

create type public.crm_lead_source as enum ('web_form', 'whatsapp', 'referral', 'manual', 'api', 'event', 'other');
create type public.crm_lead_status as enum ('new', 'contacted', 'qualified', 'disqualified', 'converted');
create type public.crm_account_kind as enum ('prospect', 'customer', 'supplier', 'partner');
create type public.crm_activity_type as enum ('call', 'meeting', 'email', 'whatsapp', 'task', 'note', 'system');
create type public.crm_deal_status as enum ('open', 'won', 'lost');
create type public.consent_basis as enum ('consent', 'contract', 'legitimate_interest', 'not_recorded');

-- ---------- tables ----------
create table public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  position int not null,
  probability int not null default 0 check (probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  check (not (is_won and is_lost)),
  unique (company_id, id),
  unique (company_id, position) deferrable initially deferred
);

create table public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind public.crm_account_kind not null default 'prospect',
  industry text,
  country char(2),
  city text,
  website text,
  email text,
  phone text,
  vat_no text,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create index crm_accounts_company_name_idx on public.crm_accounts (company_id, lower(name));

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  account_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  whatsapp text,
  job_title text,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  consent_basis public.consent_basis not null default 'not_recorded',
  consent_source text,
  consent_at timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(nullif(trim(first_name), ''), nullif(trim(last_name), '')) is not null),
  unique (company_id, id),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id) on delete set null (account_id)
);
create index crm_contacts_account_idx on public.crm_contacts (company_id, account_id);

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  first_name text,
  last_name text,
  company_name text,
  email text,
  phone text,
  source public.crm_lead_source not null default 'manual',
  source_detail text,
  status public.crm_lead_status not null default 'new',
  interest text,
  estimated_value numeric(18, 2) check (estimated_value >= 0),
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  consent_basis public.consent_basis not null default 'not_recorded',
  consent_source text,
  consent_at timestamptz,
  disqualified_reason text,
  notes text,
  converted_account_id uuid,
  converted_contact_id uuid,
  converted_deal_id uuid,
  converted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(nullif(trim(first_name), ''), nullif(trim(last_name), ''), nullif(trim(company_name), '')) is not null),
  unique (company_id, id),
  foreign key (company_id, converted_account_id) references public.crm_accounts (company_id, id) on delete set null (converted_account_id),
  foreign key (company_id, converted_contact_id) references public.crm_contacts (company_id, id) on delete set null (converted_contact_id)
);
create index crm_leads_company_status_idx on public.crm_leads (company_id, status, created_at desc);

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  account_id uuid not null,
  contact_id uuid,
  stage_id uuid not null,
  status public.crm_deal_status not null default 'open',
  value numeric(18, 2) not null default 0 check (value >= 0),
  currency char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  expected_close date,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  lost_reason text,
  closed_at timestamptz,
  source_lead_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id) on delete cascade,
  foreign key (company_id, contact_id) references public.crm_contacts (company_id, id) on delete set null (contact_id),
  foreign key (company_id, stage_id) references public.crm_pipeline_stages (company_id, id),
  foreign key (company_id, source_lead_id) references public.crm_leads (company_id, id) on delete set null (source_lead_id)
);
create index crm_deals_company_stage_idx on public.crm_deals (company_id, stage_id);
create index crm_deals_account_idx on public.crm_deals (company_id, account_id);

alter table public.crm_leads
  add foreign key (company_id, converted_deal_id) references public.crm_deals (company_id, id) on delete set null (converted_deal_id);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.crm_activity_type not null,
  subject text not null check (length(trim(subject)) > 0),
  body text,
  due_at timestamptz,
  completed_at timestamptz,
  account_id uuid,
  contact_id uuid,
  lead_id uuid,
  deal_id uuid,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, account_id) references public.crm_accounts (company_id, id) on delete set null (account_id),
  foreign key (company_id, contact_id) references public.crm_contacts (company_id, id) on delete set null (contact_id),
  foreign key (company_id, lead_id) references public.crm_leads (company_id, id) on delete set null (lead_id),
  foreign key (company_id, deal_id) references public.crm_deals (company_id, id) on delete set null (deal_id)
);
create index crm_activities_account_idx on public.crm_activities (company_id, account_id, created_at desc);
create index crm_activities_deal_idx on public.crm_activities (company_id, deal_id, created_at desc);
create index crm_activities_lead_idx on public.crm_activities (company_id, lead_id, created_at desc);
create index crm_activities_due_idx on public.crm_activities (company_id, owner_id, due_at) where completed_at is null;

-- ---------- triggers ----------
create trigger crm_accounts_touch before update on public.crm_accounts for each row execute function private.touch_updated_at();
create trigger crm_contacts_touch before update on public.crm_contacts for each row execute function private.touch_updated_at();
create trigger crm_leads_touch before update on public.crm_leads for each row execute function private.touch_updated_at();
create trigger crm_deals_touch before update on public.crm_deals for each row execute function private.touch_updated_at();
create trigger crm_activities_touch before update on public.crm_activities for each row execute function private.touch_updated_at();

-- Owners must be members of the same company
create function private.check_owner_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.company_members m where m.company_id = new.company_id and m.user_id = new.owner_id
  ) then
    raise exception 'Owner must be a member of this company';
  end if;
  return new;
end $$;
create trigger crm_accounts_owner before insert or update of owner_id on public.crm_accounts for each row execute function private.check_owner_member();
create trigger crm_contacts_owner before insert or update of owner_id on public.crm_contacts for each row execute function private.check_owner_member();
create trigger crm_leads_owner before insert or update of owner_id on public.crm_leads for each row execute function private.check_owner_member();
create trigger crm_deals_owner before insert or update of owner_id on public.crm_deals for each row execute function private.check_owner_member();
create trigger crm_activities_owner before insert or update of owner_id on public.crm_activities for each row execute function private.check_owner_member();

-- Deal status follows its stage
create function private.deal_status_from_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.crm_pipeline_stages;
begin
  select * into s from public.crm_pipeline_stages where id = new.stage_id;
  new.status := case when s.is_won then 'won' when s.is_lost then 'lost' else 'open' end::public.crm_deal_status;
  if new.status = 'open' then
    new.closed_at := null;
    new.lost_reason := null;
  elsif tg_op = 'INSERT' or old.status is distinct from new.status then
    new.closed_at := now();
  end if;
  return new;
end $$;
create trigger crm_deals_status before insert or update of stage_id on public.crm_deals
  for each row execute function private.deal_status_from_stage();

-- Timeline entries for deal events
create function private.deal_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  v_new text;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_activities (company_id, type, subject, account_id, contact_id, deal_id, owner_id, created_by, completed_at)
    values (new.company_id, 'system', 'Deal created: ' || new.name, new.account_id, new.contact_id, new.id, new.owner_id, auth.uid(), now());
  elsif new.stage_id is distinct from old.stage_id then
    select name into v_old from public.crm_pipeline_stages where id = old.stage_id;
    select name into v_new from public.crm_pipeline_stages where id = new.stage_id;
    insert into public.crm_activities (company_id, type, subject, body, account_id, contact_id, deal_id, owner_id, created_by, completed_at)
    values (new.company_id, 'system', new.name || ': ' || v_old || ' → ' || v_new,
            case when new.status = 'lost' then nullif(new.lost_reason, '') end,
            new.account_id, new.contact_id, new.id, new.owner_id, auth.uid(), now());
  end if;
  return null;
end $$;
create trigger crm_deals_timeline after insert or update of stage_id on public.crm_deals
  for each row execute function private.deal_timeline();

-- Activities inherit the account from their deal or contact so one account timeline shows everything
create function private.activity_fill_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is null and new.deal_id is not null then
    select account_id into new.account_id from public.crm_deals where id = new.deal_id and company_id = new.company_id;
  end if;
  if new.account_id is null and new.contact_id is not null then
    select account_id into new.account_id from public.crm_contacts where id = new.contact_id and company_id = new.company_id;
  end if;
  return new;
end $$;
create trigger crm_activities_fill before insert on public.crm_activities
  for each row execute function private.activity_fill_account();

-- ---------- RPCs ----------
-- System timeline entries bypass the 'no system activities from clients' policy
create function private.log_system_activity(
  p_company uuid, p_subject text, p_account uuid, p_contact uuid, p_lead uuid, p_deal uuid, p_owner uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_company, array['owner', 'admin', 'sales']::public.member_role[]) then
    raise exception 'Not allowed';
  end if;
  insert into public.crm_activities (company_id, type, subject, account_id, contact_id, lead_id, deal_id, owner_id, created_by, completed_at)
  values (p_company, 'system', p_subject, p_account, p_contact, p_lead, p_deal, p_owner, auth.uid(), now());
end $$;
revoke all on function private.log_system_activity(uuid, text, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function private.log_system_activity(uuid, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
create function public.convert_lead(
  p_lead uuid,
  p_existing_account uuid default null,
  p_create_deal boolean default true,
  p_deal_name text default null,
  p_deal_value numeric default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  l public.crm_leads;
  v_account uuid := p_existing_account;
  v_contact uuid;
  v_deal uuid;
  v_stage uuid;
  v_person text;
begin
  select * into l from public.crm_leads where id = p_lead for update;
  if l.id is null then
    raise exception 'Lead not found';
  end if;
  if l.status = 'converted' then
    raise exception 'Lead is already converted';
  end if;

  v_person := nullif(trim(concat_ws(' ', l.first_name, l.last_name)), '');

  if v_account is null then
    insert into public.crm_accounts (company_id, name, kind, email, phone, owner_id)
    values (l.company_id, coalesce(nullif(trim(l.company_name), ''), v_person), 'prospect', l.email, l.phone, l.owner_id)
    returning id into v_account;
  elsif not exists (select 1 from public.crm_accounts where id = v_account and company_id = l.company_id) then
    raise exception 'Account not found in this company';
  end if;

  if v_person is not null then
    insert into public.crm_contacts (company_id, account_id, first_name, last_name, email, phone, owner_id,
                                     consent_basis, consent_source, consent_at)
    values (l.company_id, v_account, l.first_name, l.last_name, l.email, l.phone, l.owner_id,
            l.consent_basis, l.consent_source, l.consent_at)
    returning id into v_contact;
  end if;

  if p_create_deal then
    select id into v_stage from public.crm_pipeline_stages
     where company_id = l.company_id and not is_won and not is_lost
     order by position limit 1;
    if v_stage is null then
      raise exception 'Set up at least one open pipeline stage first';
    end if;
    insert into public.crm_deals (company_id, name, account_id, contact_id, stage_id, value, currency, owner_id, source_lead_id)
    values (l.company_id,
            coalesce(nullif(trim(p_deal_name), ''), coalesce(nullif(trim(l.interest), ''), 'New deal') || ' - ' || coalesce(nullif(trim(l.company_name), ''), v_person)),
            v_account, v_contact, v_stage, coalesce(p_deal_value, l.estimated_value, 0), l.currency, l.owner_id, l.id)
    returning id into v_deal;
  end if;

  update public.crm_activities
     set account_id = coalesce(account_id, v_account), contact_id = coalesce(contact_id, v_contact)
   where lead_id = l.id;

  update public.crm_leads
     set status = 'converted', converted_account_id = v_account, converted_contact_id = v_contact,
         converted_deal_id = v_deal, converted_at = now()
   where id = l.id;

  perform private.log_system_activity(l.company_id, 'Lead converted', v_account, v_contact, l.id, v_deal, l.owner_id);

  return jsonb_build_object('account_id', v_account, 'contact_id', v_contact, 'deal_id', v_deal);
end $$;

revoke all on function public.convert_lead(uuid, uuid, boolean, text, numeric) from public, anon;
grant execute on function public.convert_lead(uuid, uuid, boolean, text, numeric) to authenticated;

-- ---------- RLS ----------
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_accounts enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_activities enable row level security;

create policy stages_select on public.crm_pipeline_stages for select to authenticated using (private.is_member(company_id));
create policy stages_write on public.crm_pipeline_stages for all to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy crm_accounts_select on public.crm_accounts for select to authenticated using (private.is_member(company_id));
create policy crm_accounts_insert on public.crm_accounts for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_accounts_update on public.crm_accounts for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_accounts_delete on public.crm_accounts for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy crm_contacts_select on public.crm_contacts for select to authenticated using (private.is_member(company_id));
create policy crm_contacts_insert on public.crm_contacts for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_contacts_update on public.crm_contacts for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_contacts_delete on public.crm_contacts for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy crm_leads_select on public.crm_leads for select to authenticated using (private.is_member(company_id));
create policy crm_leads_insert on public.crm_leads for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_leads_update on public.crm_leads for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_leads_delete on public.crm_leads for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy crm_deals_select on public.crm_deals for select to authenticated using (private.is_member(company_id));
create policy crm_deals_insert on public.crm_deals for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_deals_update on public.crm_deals for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_deals_delete on public.crm_deals for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy crm_activities_select on public.crm_activities for select to authenticated using (private.is_member(company_id));
create policy crm_activities_insert on public.crm_activities for insert to authenticated
  with check (type <> 'system' and private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_activities_update on public.crm_activities for update to authenticated
  using (type <> 'system' and private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]))
  with check (type <> 'system' and private.has_role(company_id, array['owner', 'admin', 'sales']::public.member_role[]));
create policy crm_activities_delete on public.crm_activities for delete to authenticated
  using (type <> 'system' and (created_by = (select auth.uid()) or private.has_role(company_id, array['owner', 'admin']::public.member_role[])));

revoke all on public.crm_pipeline_stages, public.crm_accounts, public.crm_contacts,
  public.crm_leads, public.crm_deals, public.crm_activities from anon;

-- ---------- audit ----------
create trigger audit_crm_stages after insert or update or delete on public.crm_pipeline_stages for each row execute function private.audit_row();
create trigger audit_crm_accounts after insert or update or delete on public.crm_accounts for each row execute function private.audit_row();
create trigger audit_crm_contacts after insert or update or delete on public.crm_contacts for each row execute function private.audit_row();
create trigger audit_crm_leads after insert or update or delete on public.crm_leads for each row execute function private.audit_row();
create trigger audit_crm_deals after insert or update or delete on public.crm_deals for each row execute function private.audit_row();

-- ---------- seed ----------
create function private.seed_crm(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.crm_pipeline_stages (company_id, name, position, probability, is_won, is_lost) values
    (p_company, 'New', 1, 10, false, false),
    (p_company, 'Qualified', 2, 25, false, false),
    (p_company, 'Quote sent', 3, 50, false, false),
    (p_company, 'Negotiation', 4, 75, false, false),
    (p_company, 'Won', 5, 100, true, false),
    (p_company, 'Lost', 6, 0, false, true);
end $$;

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
end $$;
