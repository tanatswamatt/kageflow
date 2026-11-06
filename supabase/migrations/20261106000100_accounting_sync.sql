-- Send Kageflow's posted journals to the dealer's accounting package (Xero now; Sage and others by file).
-- Kageflow stays the source: posted journals never change, so each one is sent once and recorded.

create table public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null check (provider in ('xero', 'file')),
  tenant_id text,
  tenant_name text,
  tenant_currency text,
  tenants jsonb,                         -- organisations offered at sign-in, when there's more than one
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'needs_reconnect')),
  sync_from date not null default date_trunc('month', current_date)::date,
  mode text not null default 'each' check (mode in ('each', 'daily')),
  last_synced_at timestamptz,
  last_status text,
  last_counts jsonb,
  connected_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider),
  unique (company_id, id)
);

-- OAuth tokens: no policies, so only the server (service role) can read or write them
create table public.accounting_tokens (
  connection_id uuid primary key references public.accounting_connections (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Kageflow account -> the package's account
create table public.accounting_account_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  account_id uuid not null,
  external_id text,
  external_code text,
  external_name text,
  updated_at timestamptz not null default now(),
  unique (connection_id, account_id),
  foreign key (company_id, connection_id) references public.accounting_connections (company_id, id) on delete cascade,
  foreign key (company_id, account_id) references public.accounts (company_id, id) on delete cascade
);

-- One row per Kageflow journal sent
create table public.accounting_sync_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  journal_id uuid not null,
  external_id text,
  sent_at timestamptz not null default now(),
  unique (connection_id, journal_id),
  foreign key (company_id, connection_id) references public.accounting_connections (company_id, id) on delete cascade,
  foreign key (company_id, journal_id) references public.journals (company_id, id) on delete cascade
);
create index accounting_sync_log_conn_idx on public.accounting_sync_log (connection_id, sent_at desc);

alter table public.accounting_connections enable row level security;
alter table public.accounting_tokens enable row level security;
alter table public.accounting_account_map enable row level security;
alter table public.accounting_sync_log enable row level security;

create policy accounting_connections_select on public.accounting_connections for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy accounting_connections_update on public.accounting_connections for update to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy accounting_connections_insert on public.accounting_connections for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));
create policy accounting_connections_delete on public.accounting_connections for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin']::public.member_role[]));

create policy accounting_map_select on public.accounting_account_map for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));
create policy accounting_map_write on public.accounting_account_map for all to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

create policy accounting_log_select on public.accounting_sync_log for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

-- Journals not yet sent on a connection, oldest first
create or replace function public.accounting_unsent_journals(p_connection uuid, p_limit integer default 200)
returns table (id uuid, number text, journal_date date, description text, source_type text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.number, j.journal_date, j.description, j.source_type
    from public.journals j
    join public.accounting_connections c on c.id = p_connection and c.company_id = j.company_id
   where j.status = 'posted'
     and j.journal_date >= c.sync_from
     and (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or private.has_role(c.company_id, array['owner', 'admin', 'accountant']::public.member_role[]))
     and not exists (select 1 from public.accounting_sync_log s where s.connection_id = c.id and s.journal_id = j.id)
   order by j.journal_date, j.posted_at, j.number
   limit greatest(1, least(p_limit, 1000));
$$;
revoke all on function public.accounting_unsent_journals(uuid, integer) from public, anon;
grant execute on function public.accounting_unsent_journals(uuid, integer) to authenticated, service_role;

-- The package's chart of accounts, as last read (for the mapping screen)
alter table public.accounting_connections add column external_accounts jsonb, add column external_accounts_at timestamptz;

-- Stops the scheduled run and "Sync now" sending the same journals at once
alter table public.accounting_connections add column sync_lock_until timestamptz;
