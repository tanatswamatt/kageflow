-- Kageflow 0010: issuing handles stock-counted products and requires a confirmed VIN for vehicles

create or replace function public.issue_sales_doc(p_doc uuid)
returns public.sales_docs language plpgsql security definer set search_path = '' as $$
declare
  d public.sales_docs;
  src public.sales_docs;
  co public.companies;
  a public.crm_accounts;
  l record;
  v_lines jsonb := '[]'::jsonb;
  v_rev numeric := 0; v_rev_x numeric := 0; v_vat numeric := 0; v_cogs numeric := 0;
  v_sub numeric; v_tax numeric; v_cost numeric;
  v_receivable numeric;
  v_journal uuid;
  v_credit boolean;
  dep record;
  v_take numeric;
  v_qoh numeric; v_avg numeric; v_pname text; v_tracking public.product_tracking; v_unit_cost numeric;
begin
  select * into d from public.sales_docs where id = p_doc for update;
  if d.id is null or not private.has_role(d.company_id, array['owner', 'admin', 'accountant', 'sales']::public.member_role[]) then
    raise exception 'Document not found or your role can''t issue documents';
  end if;
  if d.doc_type not in ('invoice', 'credit_note') or d.status <> 'draft' then
    raise exception 'Only draft invoices and credit notes can be issued';
  end if;
  v_credit := d.doc_type = 'credit_note';
  select * into co from public.companies where id = d.company_id;
  select * into a from public.crm_accounts where id = d.account_id;

  if not exists (select 1 from public.sales_doc_lines where doc_id = d.id) or d.total <= 0 then
    raise exception 'Add at least one line with a value before issuing';
  end if;
  if d.currency = co.base_currency and d.fx_rate <> 1 then
    raise exception 'Documents in % use a rate of 1', co.base_currency;
  end if;
  if co.vat_no is not null and round(d.total * d.fx_rate, 2) > 5000
     and (nullif(trim(coalesce(a.billing_address, '')), '') is null) then
    raise exception 'Over R5,000 SARS requires a full tax invoice: add a billing address for %', a.name;
  end if;

  if v_credit then
    select * into src from public.sales_docs where id = d.source_doc_id for update;
    if src.id is null or src.doc_type <> 'invoice' or src.status <> 'issued' then
      raise exception 'A credit note must be raised against an issued invoice';
    end if;
    if src.account_id <> d.account_id or src.currency <> d.currency then
      raise exception 'A credit note must match its invoice''s customer and currency';
    end if;
    if nullif(trim(coalesce(d.credit_reason, '')), '') is null then
      raise exception 'Give the reason for the credit note';
    end if;
    if d.total > src.amount_due then
      raise exception 'Credit note total % exceeds what is still owed on % (%)', d.total, src.number, src.amount_due;
    end if;
    if d.fx_rate <> src.fx_rate then
      perform set_config('kageflow.system', 'on', true);
      update public.sales_docs set fx_rate = src.fx_rate where id = d.id;
      perform set_config('kageflow.system', 'off', true);
      d.fx_rate := src.fx_rate;
    end if;
  end if;

  for l in
    select sl.*, tr.is_zero_rated, u.status as unit_status, u.serial_no, u.sold_doc_id, u.vin_confirmed, coalesce(uv.landed_cost, 0) as landed_cost
      from public.sales_doc_lines sl
      join public.tax_rates tr on tr.id = sl.tax_rate_id
      left join public.inventory_units u on u.id = sl.unit_id
      left join public.unit_values uv on uv.unit_id = sl.unit_id
     where sl.doc_id = d.id
     order by sl.line_no
  loop
    v_sub := round(l.line_subtotal * d.fx_rate, 2);
    v_tax := round(l.line_tax * d.fx_rate, 2);
    if l.is_zero_rated then v_rev_x := v_rev_x + v_sub; else v_rev := v_rev + v_sub; end if;
    v_vat := v_vat + v_tax;
    if l.unit_id is not null then
      if not v_credit then
        if l.unit_status in ('sold', 'written_off') then
          raise exception 'Unit % is already %', l.serial_no, l.unit_status;
        end if;
        if not l.vin_confirmed then
          raise exception 'Add the real VIN for % % before invoicing: it came from the website without one', l.serial_no, coalesce(l.description, '');
        end if;
        v_cost := l.landed_cost;
      else
        if l.sold_doc_id is distinct from src.id then
          raise exception 'Unit % was not sold on invoice %', l.serial_no, src.number;
        end if;
        select cost_amount into v_cost from public.sales_doc_lines where doc_id = src.id and unit_id = l.unit_id;
        v_cost := coalesce(v_cost, 0);
      end if;
      v_cogs := v_cogs + v_cost;
      perform set_config('kageflow.system', 'on', true);
      update public.sales_doc_lines set cost_amount = v_cost where id = l.id;
      perform set_config('kageflow.system', 'off', true);
    elsif l.product_id is not null then
      select tracking, qty_on_hand, avg_cost, name into v_tracking, v_qoh, v_avg, v_pname from public.products where id = l.product_id for update;
      if v_tracking = 'stock' then
        perform set_config('kageflow.system', 'on', true);
        if not v_credit then
          if v_qoh < l.quantity then
            raise exception 'Only % of % in stock; receive more stock or lower the quantity', trim(to_char(v_qoh, 'FM999999990.####')), v_pname;
          end if;
          v_cost := round(l.quantity * v_avg, 2);
          update public.products set qty_on_hand = qty_on_hand - l.quantity where id = l.product_id;
          insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, doc_id, reference)
          values (d.company_id, l.product_id, 'sale', -l.quantity, v_avg, d.id, 'Invoice');
        else
          select case when sum(quantity) > 0 then sum(cost_amount) / sum(quantity) end into v_unit_cost
            from public.sales_doc_lines where doc_id = src.id and product_id = l.product_id and cost_amount is not null;
          v_unit_cost := coalesce(v_unit_cost, v_avg);
          v_cost := round(l.quantity * v_unit_cost, 2);
          update public.products
             set avg_cost = case when greatest(qty_on_hand, 0) + l.quantity > 0 then round((greatest(qty_on_hand, 0) * avg_cost + l.quantity * v_unit_cost) / (greatest(qty_on_hand, 0) + l.quantity), 4) else avg_cost end,
                 qty_on_hand = qty_on_hand + l.quantity
           where id = l.product_id;
          insert into public.stock_movements (company_id, product_id, kind, qty, unit_cost, doc_id, reference)
          values (d.company_id, l.product_id, 'return', l.quantity, v_unit_cost, d.id, 'Credit note');
        end if;
        update public.sales_doc_lines set cost_amount = v_cost where id = l.id;
        perform set_config('kageflow.system', 'off', true);
        v_cogs := v_cogs + v_cost;
      end if;
    end if;
  end loop;

  v_receivable := v_rev + v_rev_x + v_vat;
  if not v_credit then
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'receivable'), 'debit', v_receivable, 'description', a.name);
    if v_rev > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue'), 'credit', v_rev); end if;
    if v_rev_x > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue_export'), 'credit', v_rev_x); end if;
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'vat'), 'credit', v_vat); end if;
    if v_cogs > 0 then
      v_lines := v_lines
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'cogs'), 'debit', v_cogs, 'description', 'Cost of goods sold')
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'inventory'), 'credit', v_cogs);
    end if;
  else
    if v_rev > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue'), 'debit', v_rev); end if;
    if v_rev_x > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'revenue_export'), 'debit', v_rev_x); end if;
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'vat'), 'debit', v_vat); end if;
    v_lines := v_lines || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'receivable'), 'credit', v_receivable, 'description', a.name);
    if v_cogs > 0 then
      v_lines := v_lines
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'inventory'), 'debit', v_cogs, 'description', 'Goods returned to stock')
        || jsonb_build_object('account_id', private.rule_account(d.company_id, 'sales_invoice', 'cogs'), 'credit', v_cogs);
    end if;
  end if;

  perform set_config('kageflow.system', 'on', true);
  d.number := private.next_doc_number(d.company_id, d.doc_type::text, case when v_credit then 'CN' else 'INV' end);
  v_journal := public.post_document(d.company_id, d.doc_type::text, d.id, d.issue_date,
    case when v_credit then 'Credit note ' else 'Invoice ' end || d.number || ' - ' || a.name, v_lines, d.currency, d.fx_rate);

  update public.sales_docs
     set status = 'issued', number = d.number, journal_id = v_journal, issued_at = now(), issued_by = auth.uid(),
         due_date = coalesce(due_date, issue_date + coalesce(a.payment_days, co.default_payment_days)),
         bill_to_name = a.name, bill_to_address = a.billing_address, bill_to_vat_no = a.vat_no
   where id = d.id
  returning * into d;

  if not v_credit then
    update public.inventory_units u set status = 'sold', sold_doc_id = d.id, sold_at = now()
      from public.sales_doc_lines sl where sl.doc_id = d.id and sl.unit_id = u.id;
    if d.source_doc_id is not null then
      update public.sales_docs set status = 'fulfilled' where id = d.source_doc_id and doc_type = 'order' and status = 'open';
    end if;
  else
    update public.inventory_units u set status = 'in_stock', sold_doc_id = null, sold_at = null
      from public.sales_doc_lines sl where sl.doc_id = d.id and sl.unit_id = u.id;
    update public.sales_docs set amount_credited = amount_credited + d.total where id = src.id;
  end if;
  perform set_config('kageflow.system', 'off', true);

  -- deposits taken against the order are applied automatically
  if not v_credit and d.source_doc_id is not null then
    for dep in
      select id, amount - amount_allocated as free from public.customer_payments
       where company_id = d.company_id and order_id = d.source_doc_id and account_id = d.account_id
         and currency = d.currency and reversal_journal_id is null and amount > amount_allocated
       order by payment_date
    loop
      select amount_due into v_take from public.sales_docs where id = d.id;
      exit when v_take <= 0;
      perform private.allocate_payment(dep.id, d.id, least(dep.free, v_take));
    end loop;
    select * into d from public.sales_docs where id = d.id;
  end if;

  perform private.emit_event(d.company_id, case when v_credit then 'credit_note.issued' else 'invoice.issued' end, jsonb_build_object(
    'id', d.id, 'number', d.number, 'reference', d.reference, 'account_id', d.account_id, 'currency', d.currency,
    'total', d.total, 'amount_due', d.amount_due, 'issue_date', d.issue_date, 'due_date', d.due_date,
    'order_id', d.source_doc_id));
  return d;
end $$;
