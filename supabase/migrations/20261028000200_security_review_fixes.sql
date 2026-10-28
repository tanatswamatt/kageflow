-- Kageflow 0019: security review fixes (KF-SR-2026-10)

-- KF-D01 Costs and the ledger are for owners, admins and accountants only.
-- The app already hid these screens from sales and viewers; now the database refuses them too.
alter policy unit_costs_select on public.unit_costs using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy journals_select on public.journals using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy lines_select on public.journal_lines using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy purchase_bills_select on public.purchase_bills using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy purchase_bill_lines_select on public.purchase_bill_lines using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy supplier_payments_select on public.supplier_payments using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy supplier_payment_allocations_select on public.supplier_payment_allocations using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));
alter policy vat_returns_select on public.vat_returns using (private.has_role(company_id, array['owner','admin','accountant']::public.member_role[]));

-- KF-P01 Table privileges: TRUNCATE ignores row-level security, TRIGGER and REFERENCES are never needed by app users.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
revoke all on public.unit_values from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- KF-E02 WhatsApp webhooks must be signed: a channel without an app secret no longer accepts messages.
do $$
declare v_def text := pg_get_functiondef('public.whatsapp_inbound(text, text, text)'::regprocedure);
begin
  v_def := replace(v_def,
    'if ch.app_secret is not null and coalesce(p_signature, '''') <>',
    'if ch.app_secret is null then raise exception ''Add the Meta app secret to this WhatsApp channel in Settings first'' using errcode = ''28000''; end if;
  if coalesce(p_signature, '''') <>');
  if position('Add the Meta app secret' in v_def) = 0 then raise exception 'whatsapp_inbound patch did not apply'; end if;
  execute v_def;
end $$;
