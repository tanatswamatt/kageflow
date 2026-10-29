-- Kageflow 0023: new records default to the company's base currency (was always ZAR),
-- so a Zimbabwe dealership keeping USD books gets USD prices, leads, deals and documents.

create function private.default_currency() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_col text := tg_argv[0];
begin
  if to_jsonb(new) ->> v_col is null then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, (select base_currency from public.companies where id = new.company_id)));
  end if;
  return new;
end $$;
revoke all on function private.default_currency() from public, anon, authenticated;

do $d$
declare r record;
begin
  for r in select * from (values
    ('crm_deals', 'currency'), ('crm_leads', 'currency'), ('customer_payments', 'currency'), ('inventory_units', 'list_currency'),
    ('journals', 'currency'), ('products', 'currency'), ('purchase_bills', 'currency'), ('sales_docs', 'currency'), ('supplier_payments', 'currency')
  ) as x (tbl, col)
  loop
    execute format('alter table public.%I alter column %I drop default', r.tbl, r.col);
    execute format('create trigger a0_default_currency before insert on public.%I for each row execute function private.default_currency(%L)', r.tbl, r.col);
  end loop;
end $d$;

-- records already created in rand by Zimbabwe dealerships before this fix (stock and products only; nothing posted)
update public.inventory_units u set list_currency = c.base_currency
  from public.companies c where c.id = u.company_id and c.country = 'ZW' and u.list_currency = 'ZAR';
update public.products p set currency = c.base_currency
  from public.companies c where c.id = p.company_id and c.country = 'ZW' and p.currency = 'ZAR';
