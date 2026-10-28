-- Kageflow 0018: platform admin (Pretan staff) overview of every dealership
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'tanamatt03@gmail.com'
on conflict do nothing;

create function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- one row per dealership: who signed up, how big it is, and whether it's being used
create function public.admin_overview()
returns table (
  company_id uuid, name text, created_at timestamptz, owner_name text, owner_email text,
  members int, vehicles int, in_stock int, leads int, invoices int, invoiced numeric,
  last_activity timestamptz, last_sign_in timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  return query
  select c.id, c.name, c.created_at, p.full_name, coalesce(p.email, ou.email::text),
         (select count(*)::int from public.company_members m where m.company_id = c.id),
         (select count(*)::int from public.inventory_units u where u.company_id = c.id),
         (select count(*)::int from public.inventory_units u where u.company_id = c.id and u.status in ('in_stock', 'reserved')),
         (select count(*)::int from public.crm_leads l where l.company_id = c.id),
         (select count(*)::int from public.sales_docs d where d.company_id = c.id and d.doc_type = 'invoice' and d.status = 'issued'),
         (select coalesce(sum(d.total), 0) from public.sales_docs d where d.company_id = c.id and d.doc_type = 'invoice' and d.status = 'issued'),
         (select max(a.at) from public.audit_log a where a.company_id = c.id),
         (select max(au.last_sign_in_at) from public.company_members m join auth.users au on au.id = m.user_id where m.company_id = c.id)
    from public.companies c
    left join public.profiles p on p.id = c.created_by
    left join auth.users ou on ou.id = c.created_by
   order by c.created_at desc;
end $$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
