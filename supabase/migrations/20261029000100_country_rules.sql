-- Kageflow 0022: country rules. A dealership is in South Africa or Zimbabwe, chosen at sign-up and fixed for life,
-- because VAT, invoices, the VAT return and privacy law all follow from it.
-- * ZA: VAT 15%, books in ZAR, notional input tax on second-hand goods from non-vendors, SARS VAT201
-- * ZW: VAT 15.5% (from 1 Jan 2026), books in USD or ZWG, no notional input tax, ZIMRA return; tax invoices come from the fiscal device

alter table public.companies add constraint companies_country_check check (country in ('ZA', 'ZW'));
alter table public.companies add constraint companies_currency_for_country
  check ((country = 'ZA' and base_currency = 'ZAR') or (country = 'ZW' and base_currency in ('USD', 'ZWG')));

create function private.lock_company_country() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.country is distinct from old.country then
    raise exception 'A company''s country can''t be changed after sign-up, because its tax and invoice rules depend on it';
  end if;
  if new.base_currency is distinct from old.base_currency then
    raise exception 'A company''s base currency can''t be changed after sign-up, because its books are kept in it';
  end if;
  return new;
end $$;
create trigger companies_lock_country before update on public.companies for each row execute function private.lock_company_country();

-- standard VAT rate for a company (its STD tax rate, else the country's)
create function private.vat_rate(p_company uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select rate from public.tax_rates where company_id = p_company and code = 'STD' and rate > 0),
    (select case country when 'ZW' then 0.155 else 0.15 end from public.companies where id = p_company),
    0.15);
$$;

create function private.tax_authority(p_company uuid) returns text language sql stable security definer set search_path = '' as $$
  select case country when 'ZW' then 'ZIMRA' else 'SARS' end from public.companies where id = p_company;
$$;
revoke all on function private.lock_company_country(), private.vat_rate(uuid), private.tax_authority(uuid) from public, anon, authenticated;
-- vat201 runs as the caller and needs the rate (not sensitive)
grant execute on function private.vat_rate(uuid) to authenticated;

-- tax rates follow the country
create or replace function private.seed_catalog(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_std uuid;
  v_zw boolean := (select country = 'ZW' from public.companies where id = p_company);
begin
  insert into public.tax_rates (company_id, code, name, rate, is_zero_rated) values
    (p_company, 'STD', case when v_zw then 'Standard rate 15.5%' else 'Standard rate 15%' end, case when v_zw then 0.155 else 0.15 end, false),
    (p_company, 'ZERO', 'Zero-rated (export)', 0, true),
    (p_company, 'EXEMPT', 'Exempt', 0, false),
    (p_company, 'NONE', 'No VAT (not a VAT vendor)', 0, false)
  on conflict (company_id, code) do nothing;
  select id into v_std from public.tax_rates where company_id = p_company and code = 'STD';
  insert into public.products (company_id, sku, name, tracking, tax_rate_id) values
    (p_company, 'VEHICLE', 'Motor vehicle', 'serial', v_std),
    (p_company, 'SERVICE', 'Service', 'none', v_std)
  on conflict (company_id, sku) do nothing;
end $$;

create or replace function private.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_ledger(p_company);
  perform private.seed_crm(p_company);
  perform private.seed_catalog(p_company);
  update public.accounts set is_capital = true where company_id = p_company and code in ('1500', '1600') and system_key is null;
  insert into public.accounts (company_id, code, name, type, system_key, is_system) values
    (p_company, '2350', 'Trade-in settlements payable', 'liability', 'tradein_settlements', true),
    (p_company, '6050', 'Sales commission', 'expense', 'commission_expense', true),
    (p_company, '2450', 'Commission payable', 'liability', 'commission_payable', true),
    (p_company, '4300', 'Finance and insurance commission', 'income', 'fi_income', true)
  on conflict do nothing;
  if (select country from public.companies where id = p_company) = 'ZW' then
    update public.accounts set name = 'PAYE, AIDS levy and NSSA payable' where company_id = p_company and code = '2400';
    insert into public.accounts (company_id, code, name, type, system_key, is_system) values
      (p_company, '6650', 'Intermediated money transfer tax (IMTT)', 'expense', null, false)
    on conflict do nothing;
  end if;
end $$;

-- sign-up takes the country (and, in Zimbabwe, USD or ZiG books)
drop function public.create_company(text, text, text, text);
create function public.create_company(
  p_name text, p_legal_name text default null, p_registration_no text default null, p_vat_no text default null,
  p_country text default 'ZA', p_base_currency text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_country text := upper(trim(coalesce(p_country, '')));
  v_currency text := upper(trim(coalesce(p_base_currency, '')));
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if v_country not in ('ZA', 'ZW') then raise exception 'Choose South Africa or Zimbabwe'; end if;
  if v_currency = '' then v_currency := case v_country when 'ZW' then 'USD' else 'ZAR' end; end if;
  if (v_country = 'ZA' and v_currency <> 'ZAR') or (v_country = 'ZW' and v_currency not in ('USD', 'ZWG')) then
    raise exception 'Choose a currency your books can be kept in for that country';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Enter your company''s trading name'; end if;
  insert into public.companies (name, legal_name, registration_no, vat_no, country, base_currency, created_by)
  values (trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_registration_no), ''), nullif(trim(p_vat_no), ''), v_country, v_currency, v_uid)
  returning id into v_id;
  insert into public.company_members (company_id, user_id, role) values (v_id, v_uid, 'owner');
  perform private.seed_company(v_id);
  return v_id;
end $$;
revoke all on function public.create_company(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_company(text, text, text, text, text, text) to authenticated;

-- patch existing functions in place; each replacement must find its text
do $patch$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('public.accept_trade_in(uuid,date)', $a$and status <> 'draft' and currency = 'ZAR') then$a$,
         $b$and status <> 'draft' and currency = (select base_currency from public.companies where id = t.company_id)) then$b$),
      ('public.accept_trade_in(uuid,date)', $a$'Link the trade-in to a confirmed order in rand, or to none'$a$,
         $b$'Link the trade-in to a confirmed order in your base currency, or to none'$b$),
      ('public.accept_trade_in(uuid,date)', $a$The settlement (R%) is more than the allowance (R%)$a$, $b$The settlement (%) is more than the allowance (%)$b$),
      ('public.accept_trade_in(uuid,date)', $a$  if v_vendor then
    v_vat := round(t.allowance * 15 / 115, 2);$a$,
         $b$  -- input tax on the seller's tax invoice; notional input tax on private sellers only where the law allows it (South Africa)
  if v_vendor and (t.seller_is_vendor or co.country = 'ZA') then
    v_vat := round(t.allowance * private.vat_rate(t.company_id) / (1 + private.vat_rate(t.company_id)), 2);$b$),
      ('public.accept_trade_in(uuid,date)', $a$p_date, 'ZAR', 1, v_credit,$a$, $b$p_date, co.base_currency, 1, v_credit,$b$),
      ('public.vat201(uuid,date,date)', $a$round((v_input - v_cap_tax) * 115 / 15, 2)$a$,
         $b$round((v_input - v_cap_tax) * (1 + private.vat_rate(p_company)) / private.vat_rate(p_company), 2)$b$),
      ('public.file_vat_return(uuid,date,date,text)', $a$'VAT owed to SARS'$a$, $b$'VAT owed to ' || private.tax_authority(p_company)$b$),
      ('public.file_vat_return(uuid,date,date,text)', $a$'VAT refund due from SARS'$a$, $b$'VAT refund due from ' || private.tax_authority(p_company)$b$),
      ('public.record_finance_payout(uuid,numeric,uuid,date)', $a$p_bank_account, 'ZAR', 1, p_date$a$,
         $b$p_bank_account, (select base_currency from public.companies where id = s.company_id), 1, p_date$b$),
      ('public.issue_sales_doc(uuid)', $a$if co.vat_no is not null and round(d.total * d.fx_rate, 2) > 5000$a$,
         $b$if co.vat_no is not null and co.country = 'ZA' and round(d.total * d.fx_rate, 2) > 5000$b$),
      ('public.post_document(uuid,text,uuid,date,text,jsonb,character,numeric)', $a$p_currency character DEFAULT 'ZAR'::bpchar$a$, $b$p_currency character DEFAULT NULL::bpchar$b$),
      ('public.post_document(uuid,text,uuid,date,text,jsonb,character,numeric)', $a$p_source_type, p_source_id, p_currency, p_fx_rate)$a$,
         $b$p_source_type, p_source_id, coalesce(p_currency, (select base_currency from public.companies where id = p_company)), p_fx_rate)$b$),
      ('private.capture_lead(uuid,crm_lead_source,text,text,text,text,text,text,text,crm_activity_type,text,boolean)', $a$then u.list_currency else 'ZAR' end$a$,
         $b$then u.list_currency else (select base_currency from public.companies where id = p_company) end$b$),
      ('private.apply_stock_feed(uuid,jsonb)', $a$then n ->> 'currency' else 'ZAR' end$a$,
         $b$then n ->> 'currency' else (select base_currency from public.companies where id = s.company_id) end$b$),
      ('public.api_submit_lead(text,jsonb)', $a$then p_lead ->> 'currency' else 'ZAR' end$a$,
         $b$then p_lead ->> 'currency' else (select base_currency from public.companies where id = v_company) end$b$)
    ) as x (fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old_text in v_def) = 0 then
      raise exception 'Patch for % did not find: %', r.fn, r.old_text;
    end if;
    v_new := replace(v_def, r.old_text, r.new_text);
    execute v_new;
  end loop;
end $patch$;

-- shared invoice links carry the country, so the printed document follows its rules
do $p$
declare v_def text := pg_get_functiondef('public.shared_sales_doc(text)'::regprocedure);
begin
  if position($a$'base_currency', c.base_currency),$a$ in v_def) = 0 then raise exception 'shared_sales_doc patch target missing'; end if;
  execute replace(v_def, $a$'base_currency', c.base_currency),$a$, $b$'base_currency', c.base_currency, 'country', c.country),$b$);
end $p$;
