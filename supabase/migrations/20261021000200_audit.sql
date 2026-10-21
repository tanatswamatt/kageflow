-- Kageflow 0002: append-only audit log written by triggers
-- No FK on company_id so the trail survives deletes.

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor uuid,
  at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index audit_log_company_at_idx on public.audit_log (company_id, at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

create function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
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

alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant']::public.member_role[]));

revoke all on public.audit_log from anon;
revoke insert, update on public.audit_log from authenticated;

create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function private.audit_row();
create trigger audit_company_members after insert or update or delete on public.company_members
  for each row execute function private.audit_row();
