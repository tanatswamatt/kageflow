-- Kageflow 0016: stock checks (walk the lot, scan every VIN, see what's missing)
create table public.stock_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  location text,
  status text not null default 'open' check (status in ('open', 'closed')),
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  expected int,
  found int,
  missing int,
  unknown int,
  unique (company_id, id)
);
create index stock_checks_company_idx on public.stock_checks (company_id, started_at desc);

create table public.stock_check_scans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  check_id uuid not null,
  vin text not null,
  unit_id uuid,
  scanned_by uuid default auth.uid(),
  scanned_at timestamptz not null default now(),
  unique (check_id, vin),
  foreign key (company_id, check_id) references public.stock_checks (company_id, id) on delete cascade,
  foreign key (company_id, unit_id) references public.inventory_units (company_id, id) on delete set null (unit_id)
);

-- link each scan to the car with that VIN, and stop scans on closed checks
create function private.stock_scan_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.stock_checks where id = new.check_id) <> 'open' then
    raise exception 'This stock check is closed';
  end if;
  new.vin := upper(regexp_replace(new.vin, '[^A-Za-z0-9]', '', 'g'));
  select id into new.unit_id from public.inventory_units where company_id = new.company_id and upper(serial_no) = new.vin;
  return new;
end $$;
create trigger stock_check_scans_link before insert on public.stock_check_scans for each row execute function private.stock_scan_link();

-- closing records the counts against what Kageflow says should be on the lot
create function public.close_stock_check(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.stock_checks;
  v_expected int; v_found int; v_unknown int;
begin
  select * into c from public.stock_checks where id = p_id for update;
  if c.id is null or not private.has_role(c.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Stock check not found or your role can''t close it';
  end if;
  if c.status = 'closed' then raise exception 'Already closed'; end if;
  select count(*) into v_expected from public.inventory_units u
   where u.company_id = c.company_id and u.status in ('in_stock', 'reserved')
     and (c.location is null or u.location ilike c.location || '%');
  select count(*) filter (where unit_id is not null), count(*) filter (where unit_id is null) into v_found, v_unknown
    from public.stock_check_scans where check_id = c.id;
  update public.stock_checks set status = 'closed', closed_at = now(), expected = v_expected, found = v_found,
         missing = greatest(v_expected - v_found, 0), unknown = v_unknown
   where id = c.id;
  return jsonb_build_object('expected', v_expected, 'found', v_found, 'missing', greatest(v_expected - v_found, 0), 'unknown', v_unknown);
end $$;

alter table public.stock_checks enable row level security;
alter table public.stock_check_scans enable row level security;
create policy stock_checks_select on public.stock_checks for select to authenticated using (private.is_member(company_id));
create policy stock_checks_insert on public.stock_checks for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) and status = 'open');
create policy stock_check_scans_select on public.stock_check_scans for select to authenticated using (private.is_member(company_id));
create policy stock_check_scans_insert on public.stock_check_scans for insert to authenticated
  with check (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]));
create policy stock_check_scans_remove on public.stock_check_scans for delete to authenticated
  using (private.has_role(company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[])
         and exists (select 1 from public.stock_checks c where c.id = check_id and c.status = 'open'));
revoke all on public.stock_checks, public.stock_check_scans from anon;
revoke update on public.stock_checks, public.stock_check_scans from authenticated;

revoke all on function public.close_stock_check(uuid) from public, anon;
grant execute on function public.close_stock_check(uuid) to authenticated;

create trigger audit_stock_checks after insert or update or delete on public.stock_checks for each row execute function private.audit_row();
