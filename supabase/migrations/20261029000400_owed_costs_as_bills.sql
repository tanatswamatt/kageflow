-- Kageflow 0025: a car cost "owed to the seller" becomes a posted supplier bill, so it shows in Payables and
-- Supplier payments can settle it. Before, it was only a ledger entry against Accounts payable with no bill behind it.
do $p$
declare
  v_def text := pg_get_functiondef('public.add_unit_cost(uuid,unit_cost_kind,numeric,uuid,numeric,date,text,uuid,text)'::regprocedure);
  v_old text := $a$    raise exception 'Pick the bank, payables or clearing account the cost was paid from';
  end if;
$a$;
  v_new text := $b$    raise exception 'Pick the bank, payables or clearing account the cost was paid from';
  end if;

  -- owed to a supplier: enter it as a supplier bill so it is in Payables and can be paid against
  if p_paid_from = private.system_account(u.company_id, 'payables') then
    declare
      co public.companies;
      sup public.crm_accounts;
      v_bill uuid;
      v_rate uuid;
    begin
      select * into co from public.companies where id = u.company_id;
      select * into sup from public.crm_accounts where id = p_supplier and company_id = u.company_id;
      if sup.id is null then
        raise exception 'Choose who you bought it from, so Kageflow knows who you owe';
      end if;
      select id into v_rate from public.tax_rates
       where company_id = u.company_id and code = case when coalesce(p_vat, 0) > 0 then 'STD' else 'NONE' end;
      v_bill := public.save_bill(null, u.company_id, sup.id, p_reference, p_date,
        p_date + coalesce(sup.payment_days, co.default_payment_days, 30), co.base_currency, 1, null, null,
        jsonb_build_array(jsonb_build_object(
          'kind', 'vehicle', 'unit_id', u.id, 'cost_kind', p_kind::text,
          'description', coalesce(nullif(trim(p_description), ''), initcap(p_kind::text)) || ' - ' || coalesce(u.stock_no || ' ', '') || u.serial_no,
          'quantity', '1', 'unit_price', round(p_amount, 2)::text, 'tax_rate_id', v_rate, 'vat', round(coalesce(p_vat, 0), 2)::text)));
      perform public.post_bill(v_bill);
      return (select id from public.unit_costs where bill_id = v_bill order by created_at limit 1);
    end;
  end if;
$b$;
begin
  if position(v_old in v_def) = 0 then raise exception 'add_unit_cost patch target missing'; end if;
  execute replace(v_def, v_old, v_new);
end $p$;
