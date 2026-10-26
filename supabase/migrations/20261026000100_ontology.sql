-- Kageflow 0017: ontology layer (catalogue, links, timelines, search) and data matching
-- * ontology_object_types / ontology_link_types describe the business objects and how they connect (read by the app and, later, Ask Kageflow)
-- * object_events is one timeline across every department for a vehicle or a customer; it reads through each table's own access rules
-- * search_everything finds any object by stock number, VIN, name, phone, email or document number
-- * match_accounts / duplicate_accounts / merge_accounts join records from different silos into one customer

-- ---------- catalogue ----------
create table public.ontology_object_types (
  key text primary key,
  label text not null,
  plural text not null,
  description text not null,
  source_table text not null,
  title_template text not null,
  url_template text not null,
  properties jsonb not null default '[]'::jsonb,
  position int not null default 0
);
create table public.ontology_link_types (
  key text primary key,
  from_type text not null references public.ontology_object_types (key),
  to_type text not null references public.ontology_object_types (key),
  label text not null,
  reverse_label text not null,
  cardinality text not null check (cardinality in ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
  via text not null
);
alter table public.ontology_object_types enable row level security;
alter table public.ontology_link_types enable row level security;
create policy ontology_object_types_read on public.ontology_object_types for select to authenticated using (true);
create policy ontology_link_types_read on public.ontology_link_types for select to authenticated using (true);
revoke all on public.ontology_object_types, public.ontology_link_types from anon;
revoke insert, update on public.ontology_object_types, public.ontology_link_types from authenticated;

insert into public.ontology_object_types (key, label, plural, description, source_table, title_template, url_template, properties, position) values
('vehicle', 'Vehicle', 'Vehicles', 'A car on the lot, on its way, or sold, identified by VIN and stock number', 'inventory_units', '{year} {make} {model} ({stock_no})', '/inventory/units/{id}',
  '[{"key":"stock_no","label":"Stock number"},{"key":"serial_no","label":"VIN"},{"key":"make","label":"Make"},{"key":"model","label":"Model"},{"key":"year","label":"Year"},{"key":"mileage_km","label":"Mileage"},{"key":"status","label":"Status"},{"key":"list_price","label":"Price","sensitivity":"commercial"},{"key":"landed_cost","label":"Landed cost","sensitivity":"financial"}]', 1),
('customer', 'Customer', 'Customers and suppliers', 'A person or company you sell to or buy from', 'crm_accounts', '{name}', '/crm/accounts/{id}',
  '[{"key":"name","label":"Name"},{"key":"kind","label":"Kind"},{"key":"email","label":"Email","sensitivity":"personal"},{"key":"phone","label":"Phone","sensitivity":"personal"},{"key":"vat_no","label":"VAT number"}]', 2),
('contact', 'Contact', 'Contacts', 'A person at a customer', 'crm_contacts', '{first_name} {last_name}', '/crm/contacts/{id}', '[{"key":"email","label":"Email","sensitivity":"personal"},{"key":"phone","label":"Phone","sensitivity":"personal"}]', 3),
('lead', 'Lead', 'Leads', 'An enquiry from a portal, WhatsApp, email, the website or a walk-in', 'crm_leads', '{first_name} {last_name}', '/crm/leads/{id}', '[{"key":"source","label":"Source"},{"key":"status","label":"Status"},{"key":"interest","label":"Interested in"}]', 4),
('deal', 'Deal', 'Deals', 'A sale being worked through the pipeline', 'crm_deals', '{name}', '/crm/deals/{id}', '[{"key":"value","label":"Value","sensitivity":"commercial"},{"key":"status","label":"Status"}]', 5),
('sales_doc', 'Sales document', 'Quotes, orders, invoices and credit notes', 'A quote, order, tax invoice or credit note', 'sales_docs', '{number}', '/sales/doc/{id}', '[{"key":"doc_type","label":"Type"},{"key":"number","label":"Number"},{"key":"total","label":"Total"},{"key":"amount_due","label":"Owed"}]', 6),
('payment', 'Payment', 'Payments received', 'Money in: cash, EFT, bank payouts and trade-in credits', 'customer_payments', '{number}', '/sales/payments/{id}', '[{"key":"amount","label":"Amount"},{"key":"method","label":"Method"}]', 7),
('finance_application', 'Finance application', 'Finance applications', 'A buyer''s vehicle finance application and the banks'' answers', 'finance_applications', '{number}', '/sales/finance/{id}', '[{"key":"status","label":"Status"},{"key":"id_number","label":"ID number","sensitivity":"personal"},{"key":"net_income","label":"Income","sensitivity":"personal"}]', 8),
('trade_in', 'Trade-in', 'Trade-ins', 'A car taken in as part of a deal', 'trade_ins', '{number}', '/sales/trade-ins/{id}', '[{"key":"allowance","label":"Allowance","sensitivity":"commercial"},{"key":"settlement_amount","label":"Settlement"}]', 9),
('bill', 'Bill', 'Bills and expenses', 'A supplier invoice or a paid-now expense', 'purchase_bills', '{number}', '/purchases/bills/{id}', '[{"key":"total","label":"Total","sensitivity":"financial"}]', 10),
('message', 'WhatsApp message', 'WhatsApp messages', 'A message to or from a buyer on WhatsApp', 'whatsapp_messages', '{body}', '/crm/leads/{lead_id}', '[{"key":"body","label":"Text","sensitivity":"personal"}]', 11),
('team_member', 'Team member', 'Team', 'Someone who signs in to Kageflow', 'company_members', '{name}', '/settings/members', '[{"key":"role","label":"Role"}]', 12),
('journal', 'Journal', 'Journals', 'A posted accounting entry; every money event has one', 'journals', '{number}', '/accounting/journals/{id}', '[{"key":"description","label":"Description","sensitivity":"financial"}]', 13);

insert into public.ontology_link_types (key, from_type, to_type, label, reverse_label, cardinality, via) values
('lead_vehicle', 'lead', 'vehicle', 'is interested in', 'has enquiries', 'many_to_one', 'crm_leads.unit_id'),
('lead_customer', 'lead', 'customer', 'became', 'came from lead', 'many_to_one', 'crm_leads.converted_account_id'),
('lead_messages', 'message', 'lead', 'belongs to', 'has WhatsApp messages', 'many_to_one', 'whatsapp_messages.lead_id'),
('contact_customer', 'contact', 'customer', 'works at', 'has contacts', 'many_to_one', 'crm_contacts.account_id'),
('deal_customer', 'deal', 'customer', 'is with', 'has deals', 'many_to_one', 'crm_deals.account_id'),
('doc_customer', 'sales_doc', 'customer', 'is addressed to', 'has documents', 'many_to_one', 'sales_docs.account_id'),
('doc_vehicle', 'sales_doc', 'vehicle', 'includes', 'appears on', 'many_to_many', 'sales_doc_lines.unit_id'),
('doc_deal', 'sales_doc', 'deal', 'belongs to', 'has documents', 'many_to_one', 'sales_docs.deal_id'),
('payment_customer', 'payment', 'customer', 'is from', 'has paid', 'many_to_one', 'customer_payments.account_id'),
('payment_doc', 'payment', 'sales_doc', 'pays', 'is paid by', 'many_to_many', 'payment_allocations'),
('finance_customer', 'finance_application', 'customer', 'is for', 'has finance applications', 'many_to_one', 'finance_applications.account_id'),
('finance_vehicle', 'finance_application', 'vehicle', 'finances', 'is financed by', 'many_to_one', 'finance_applications.unit_id'),
('tradein_customer', 'trade_in', 'customer', 'was traded by', 'traded in', 'many_to_one', 'trade_ins.account_id'),
('tradein_vehicle', 'trade_in', 'vehicle', 'became', 'came in as a trade-in', 'one_to_one', 'trade_ins.unit_id'),
('bill_supplier', 'bill', 'customer', 'is from supplier', 'has bills', 'many_to_one', 'purchase_bills.supplier_id'),
('bill_vehicle', 'bill', 'vehicle', 'adds cost to', 'has costs on', 'many_to_many', 'purchase_bill_lines.unit_id'),
('vehicle_supplier', 'vehicle', 'customer', 'was bought from', 'sold us', 'many_to_one', 'inventory_units.supplier_account_id'),
('doc_salesperson', 'sales_doc', 'team_member', 'was sold by', 'sold', 'many_to_one', 'sales_docs.salesperson_id'),
('doc_journal', 'sales_doc', 'journal', 'is booked in', 'books', 'one_to_one', 'sales_docs.journal_id');

-- ---------- leads link to the car they asked about ----------
alter table public.crm_leads add column unit_id uuid;
alter table public.crm_leads add foreign key (company_id, unit_id) references public.inventory_units (company_id, id) on delete set null (unit_id);
create index crm_leads_unit_idx on public.crm_leads (company_id, unit_id) where unit_id is not null;
update public.crm_leads l set unit_id = u.id
  from public.inventory_units u
 where l.unit_id is null and u.company_id = l.company_id and u.stock_no is not null
   and l.interest like '%(' || u.stock_no || ')%';

create or replace function private.capture_lead(
  p_company uuid, p_source public.crm_lead_source, p_detail text,
  p_first text, p_last text, p_email text, p_phone text,
  p_subject text, p_message text, p_activity public.crm_activity_type,
  p_external_ref text default null, p_log boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_text text := coalesce(p_subject, '') || ' ' || coalesce(p_message, '');
  v_stock text := upper((regexp_match(v_text, '(STK-?\d{4,6})', 'i'))[1]);
  v_vin text := upper((regexp_match(v_text, '\m([A-HJ-NPR-Z0-9]{17})\M', 'i'))[1]);
  u public.inventory_units;
  v_lead uuid;
  v_created boolean := false;
  v_phone text := private.phone_key(p_phone);
  v_email text := lower(nullif(trim(p_email), ''));
  v_interest text;
begin
  if p_external_ref is not null then
    select id into v_lead from public.crm_leads where company_id = p_company and external_ref = p_external_ref;
    if v_lead is not null then
      return jsonb_build_object('lead_id', v_lead, 'created', false, 'duplicate', true);
    end if;
  end if;
  if v_stock is not null then
    if v_stock !~ '-' then v_stock := 'STK-' || lpad(substr(v_stock, 4), 6, '0'); else v_stock := 'STK-' || lpad(split_part(v_stock, '-', 2), 6, '0'); end if;
    select * into u from public.inventory_units where company_id = p_company and stock_no = v_stock;
  end if;
  if u.id is null and v_vin is not null then
    select * into u from public.inventory_units where company_id = p_company and upper(serial_no) = v_vin;
  end if;
  if u.id is not null then
    v_interest := concat_ws(' ', u.year, u.make, u.model, u.variant) || ' (' || u.stock_no || ')';
  end if;

  select id into v_lead from public.crm_leads
   where company_id = p_company and status not in ('converted', 'disqualified') and created_at > now() - interval '90 days'
     and ((v_phone is not null and private.phone_key(phone) = v_phone) or (v_email is not null and lower(email) = v_email))
   order by created_at desc limit 1;

  if v_lead is null then
    insert into public.crm_leads (company_id, first_name, last_name, email, phone, source, source_detail, interest, estimated_value, currency, notes, external_ref, owner_id, unit_id)
    values (p_company,
            left(coalesce(nullif(trim(p_first), ''), case when nullif(trim(p_last), '') is null then coalesce(nullif(trim(p_phone), ''), v_email, 'Unknown') end), 100),
            left(nullif(trim(p_last), ''), 100), left(v_email, 200), left(nullif(trim(p_phone), ''), 50),
            p_source, left(p_detail, 200), left(v_interest, 500),
            case when u.id is not null then coalesce(u.advert_price, u.list_price) end,
            case when u.id is not null then u.list_currency else 'ZAR' end,
            left(nullif(trim(p_message), ''), 4000), p_external_ref, null, u.id)
    returning id into v_lead;
    v_created := true;
  else
    update public.crm_leads
       set interest = coalesce(interest, left(v_interest, 500)),
           unit_id = coalesce(unit_id, u.id),
           email = coalesce(email, left(v_email, 200)),
           phone = coalesce(phone, left(nullif(trim(p_phone), ''), 50))
     where id = v_lead;
  end if;

  if p_log or v_created then
    insert into public.crm_activities (company_id, type, subject, body, lead_id, owner_id, created_by, completed_at)
    values (p_company, p_activity,
            left(coalesce(nullif(trim(p_subject), ''), 'Enquiry via ' || p_detail) || case when u.id is not null and coalesce(p_subject, '') !~* u.stock_no then ' · ' || u.stock_no else '' end, 300),
            left(nullif(trim(p_message), ''), 8000), v_lead, null, null, now());
  end if;

  if v_created then
    perform private.emit_event(p_company, 'lead.created', jsonb_build_object(
      'id', v_lead, 'source', p_source, 'source_detail', p_detail, 'stock_no', u.stock_no,
      'first_name', p_first, 'last_name', p_last, 'email', v_email, 'phone', p_phone));
  end if;
  return jsonb_build_object('lead_id', v_lead, 'created', v_created, 'unit_id', u.id, 'stock_no', u.stock_no);
end $$;

-- ---------- one timeline across departments ----------
create view public.object_events with (security_invoker = true) as
-- vehicles
select u.company_id, 'vehicle'::text as subject_type, u.id as subject_id, coalesce(u.acquired_on::timestamptz, u.created_at) as at, 'stock'::text as kind,
       'Added to stock' || case when u.external_id is not null then ' from the website' else '' end as title,
       concat_ws(' · ', u.stock_no, u.location) as detail, null::numeric as amount, null::text as currency, 'vehicle'::text as ref_type, u.id as ref_id
  from public.inventory_units u
union all
select c.company_id, 'vehicle', c.unit_id, c.created_at, 'cost',
       initcap(case c.kind when 'repairs' then 'reconditioning' else c.kind::text end) || ' cost' || case when c.reversal_journal_id is not null then ' (reversed)' else '' end,
       concat_ws(' · ', c.description, c.reference), c.amount, 'ZAR', 'journal', c.journal_id
  from public.unit_costs c
union all
select p.company_id, 'vehicle', p.unit_id, min(p.created_at), 'advert', count(*) || case when count(*) = 1 then ' photo added' else ' photos added' end, null, null, null, 'vehicle', p.unit_id
  from public.vehicle_photos p group by p.company_id, p.unit_id, date_trunc('day', p.created_at)
union all
select u.company_id, 'vehicle', u.id, u.published_at, 'advert', 'Advertised on the stock feeds', null, coalesce(u.advert_price, u.list_price), u.list_currency, 'vehicle', u.id
  from public.inventory_units u where u.published_at is not null
union all
select l.company_id, 'vehicle', l.unit_id, l.created_at, 'lead',
       'Enquiry from ' || coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company_name, 'a buyer'),
       concat_ws(' · ', initcap(replace(l.source::text, '_', ' ')), l.source_detail), null, null, 'lead', l.id
  from public.crm_leads l where l.unit_id is not null
union all
select w.company_id, 'vehicle', l.unit_id, min(w.created_at), 'message', count(*) || ' WhatsApp message' || case when count(*) = 1 then '' else 's' end || ' with ' || coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'a buyer'),
       null, null, null, 'lead', l.id
  from public.whatsapp_messages w join public.crm_leads l on l.id = w.lead_id
 where l.unit_id is not null group by w.company_id, l.unit_id, l.id, l.first_name, l.last_name, date_trunc('day', w.created_at)
union all
select d.company_id, 'vehicle', sl.unit_id, coalesce(d.issued_at, d.created_at), 'sale',
       initcap(replace(d.doc_type::text, '_', ' ')) || ' ' || coalesce(d.number, '(draft)') || ' for ' || a.name,
       initcap(d.status::text), sl.line_total, d.currency, 'sales_doc', d.id
  from public.sales_doc_lines sl join public.sales_docs d on d.id = sl.doc_id join public.crm_accounts a on a.id = d.account_id
 where sl.unit_id is not null
union all
select f.company_id, 'vehicle', f.unit_id, f.created_at, 'finance', 'Finance application ' || f.number, initcap(replace(f.status, '_', ' ')), null, null, 'finance_application', f.id
  from public.finance_applications f where f.unit_id is not null
union all
select s.company_id, 'vehicle', f.unit_id, coalesce(s.decided_at, s.submitted_at), 'finance', s.bank || ': ' || replace(s.status, '_', ' '), s.conditions, coalesce(s.payout_amount, s.approved_amount), 'ZAR', 'finance_application', f.id
  from public.finance_submissions s join public.finance_applications f on f.id = s.application_id where f.unit_id is not null
union all
select t.company_id, 'vehicle', t.unit_id, t.accepted_at, 'stock', 'Taken in on trade-in ' || t.number, a.name, t.allowance, 'ZAR', 'trade_in', t.id
  from public.trade_ins t join public.crm_accounts a on a.id = t.account_id where t.unit_id is not null and t.accepted_at is not null
union all
select s.company_id, 'vehicle', s.unit_id, s.scanned_at, 'check', 'Found in stock check', c.name, null, null, 'stock_check', c.id
  from public.stock_check_scans s join public.stock_checks c on c.id = s.check_id where s.unit_id is not null
union all
select u.company_id, 'vehicle', u.id, u.sold_at, 'sale', 'Sold', null, null, null, 'sales_doc', u.sold_doc_id
  from public.inventory_units u where u.sold_at is not null
-- customers
union all
select a.company_id, 'customer', a.id, a.created_at, 'crm', 'Added as a ' || a.kind::text, null, null, null, 'customer', a.id
  from public.crm_accounts a
union all
select c.company_id, 'customer', c.account_id, c.created_at, 'crm', 'Contact added: ' || concat_ws(' ', c.first_name, c.last_name), c.job_title, null, null, 'contact', c.id
  from public.crm_contacts c where c.account_id is not null
union all
select l.company_id, 'customer', l.converted_account_id, l.created_at, 'lead', 'Enquiry via ' || initcap(replace(l.source::text, '_', ' ')), l.interest, null, null, 'lead', l.id
  from public.crm_leads l where l.converted_account_id is not null
union all
select w.company_id, 'customer', l.converted_account_id, min(w.created_at), 'message', count(*) || ' WhatsApp message' || case when count(*) = 1 then '' else 's' end, null, null, null, 'lead', l.id
  from public.whatsapp_messages w join public.crm_leads l on l.id = w.lead_id
 where l.converted_account_id is not null group by w.company_id, l.converted_account_id, l.id, date_trunc('day', w.created_at)
union all
select d.company_id, 'customer', d.account_id, d.created_at, 'deal', 'Deal opened: ' || d.name, null, d.value, d.currency, 'deal', d.id
  from public.crm_deals d
union all
select d.company_id, 'customer', d.account_id, d.closed_at, 'deal', 'Deal ' || d.status::text || ': ' || d.name, null, d.value, d.currency, 'deal', d.id
  from public.crm_deals d where d.closed_at is not null
union all
select x.company_id, 'customer', x.account_id, coalesce(x.completed_at, x.created_at), 'activity', initcap(x.type::text) || ': ' || x.subject, left(x.body, 240), null, null, 'activity', x.id
  from public.crm_activities x where x.account_id is not null
union all
select d.company_id, 'customer', d.account_id, coalesce(d.issued_at, d.created_at), 'sale',
       initcap(replace(d.doc_type::text, '_', ' ')) || ' ' || coalesce(d.number, '(draft)'), initcap(d.status::text), d.total, d.currency, 'sales_doc', d.id
  from public.sales_docs d
union all
select p.company_id, 'customer', p.account_id, p.created_at, 'payment',
       case p.method when 'trade_in' then 'Trade-in credit ' when 'bank_payout' then 'Bank payout ' else 'Payment received ' end || coalesce(p.number, '') || case when p.reversal_journal_id is not null then ' (reversed)' else '' end,
       p.reference, p.amount, p.currency, 'payment', p.id
  from public.customer_payments p
union all
select f.company_id, 'customer', f.account_id, f.created_at, 'finance', 'Finance application ' || f.number, initcap(replace(f.status, '_', ' ')), null, null, 'finance_application', f.id
  from public.finance_applications f
union all
select t.company_id, 'customer', t.account_id, coalesce(t.accepted_at, t.created_at), 'stock', 'Trade-in ' || t.number || ': ' || concat_ws(' ', t.year, t.make, t.model), initcap(t.status), t.allowance, 'ZAR', 'trade_in', t.id
  from public.trade_ins t
union all
select b.company_id, 'customer', b.supplier_id, coalesce(b.posted_at, b.created_at), 'purchase', case when b.paid_from_account_id is null then 'Bill ' else 'Expense ' end || coalesce(b.number, '(draft)'), b.supplier_ref, b.total, b.currency, 'bill', b.id
  from public.purchase_bills b where b.status <> 'void' or b.number is not null
union all
select s.company_id, 'customer', s.supplier_id, s.created_at, 'payment', 'Paid ' || coalesce(s.number, ''), s.reference, s.amount, s.currency, 'supplier_payment', s.id
  from public.supplier_payments s
union all
select u.company_id, 'customer', u.supplier_account_id, coalesce(u.acquired_on::timestamptz, u.created_at), 'stock', 'Sold us ' || concat_ws(' ', u.year, u.make, u.model), u.stock_no, null, null, 'vehicle', u.id
  from public.inventory_units u where u.supplier_account_id is not null;

revoke all on public.object_events from anon;
grant select on public.object_events to authenticated;

-- ---------- find anything ----------
create function private.name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '\m(pty|ltd|limited|cc|inc|the|and)\M|\(|\)|[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

create function public.search_everything(p_company uuid, p_q text)
returns table (object_type text, id uuid, title text, subtitle text)
language sql stable security invoker set search_path = '' as $$
  with q as (select trim(p_q) as t, '%' || trim(p_q) || '%' as pat, private.phone_key(p_q) as ph)
  (select 'vehicle', u.id, concat_ws(' ', u.year, u.make, u.model, u.variant), concat_ws(' · ', u.stock_no, u.serial_no, replace(u.status::text, '_', ' '))
     from public.inventory_units u, q
    where u.company_id = p_company and length(q.t) >= 2
      and (u.stock_no ilike q.pat or u.serial_no ilike q.pat or concat_ws(' ', u.make, u.model, u.variant) ilike q.pat)
    order by u.created_at desc limit 8)
  union all
  (select 'customer', a.id, a.name, concat_ws(' · ', a.kind::text, a.email, a.phone)
     from public.crm_accounts a, q
    where a.company_id = p_company and length(q.t) >= 2
      and (a.name ilike q.pat or a.email ilike q.pat or a.vat_no ilike q.pat or (q.ph is not null and private.phone_key(a.phone) = q.ph))
    order by a.name limit 8)
  union all
  (select 'contact', c.id, concat_ws(' ', c.first_name, c.last_name), concat_ws(' · ', c.email, c.phone)
     from public.crm_contacts c, q
    where c.company_id = p_company and length(q.t) >= 2
      and (concat_ws(' ', c.first_name, c.last_name) ilike q.pat or c.email ilike q.pat or (q.ph is not null and (private.phone_key(c.phone) = q.ph or private.phone_key(c.whatsapp) = q.ph)))
    limit 8)
  union all
  (select 'lead', l.id, coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company_name), concat_ws(' · ', l.status::text, l.interest)
     from public.crm_leads l, q
    where l.company_id = p_company and length(q.t) >= 2
      and (concat_ws(' ', l.first_name, l.last_name, l.company_name) ilike q.pat or l.email ilike q.pat or (q.ph is not null and private.phone_key(l.phone) = q.ph))
    order by l.created_at desc limit 8)
  union all
  (select 'sales_doc', d.id, coalesce(d.number, 'Draft ' || replace(d.doc_type::text, '_', ' ')), concat_ws(' · ', replace(d.doc_type::text, '_', ' '), d.reference, d.total::text)
     from public.sales_docs d, q
    where d.company_id = p_company and length(q.t) >= 2 and (d.number ilike q.pat or d.reference ilike q.pat)
    order by d.created_at desc limit 8)
  union all
  (select 'bill', b.id, coalesce(b.number, 'Draft bill'), concat_ws(' · ', b.supplier_ref, b.total::text)
     from public.purchase_bills b, q
    where b.company_id = p_company and length(q.t) >= 2 and (b.number ilike q.pat or b.supplier_ref ilike q.pat)
    limit 8)
  union all
  (select 'finance_application', f.id, f.number, concat_ws(' · ', concat_ws(' ', f.first_name, f.last_name), f.status)
     from public.finance_applications f, q
    where f.company_id = p_company and length(q.t) >= 2 and (f.number ilike q.pat or concat_ws(' ', f.first_name, f.last_name) ilike q.pat)
    limit 8)
  union all
  (select 'trade_in', t.id, t.number, concat_ws(' ', t.year, t.make, t.model)
     from public.trade_ins t, q
    where t.company_id = p_company and length(q.t) >= 2 and (t.number ilike q.pat or t.vin ilike q.pat or t.registration ilike q.pat)
    limit 8);
$$;

-- ---------- matching records from different silos ----------
-- p_rows: [{"i": 0, "name": "...", "email": "...", "phone": "...", "vat_no": "..."}] -> best existing customer per row
create function public.match_accounts(p_company uuid, p_rows jsonb)
returns table (i int, account_id uuid, account_name text, matched_on text)
language sql stable security invoker set search_path = '' as $$
  select (r ->> 'i')::int, m.id, m.name, m.matched_on
    from jsonb_array_elements(p_rows) r
    cross join lateral (
      select a.id, a.name, x.matched_on
        from public.crm_accounts a
        cross join lateral (select case
            when nullif(regexp_replace(coalesce(r ->> 'vat_no', ''), '\s', '', 'g'), '') is not null
                 and regexp_replace(coalesce(a.vat_no, ''), '\s', '', 'g') = regexp_replace(r ->> 'vat_no', '\s', '', 'g') then 'VAT number'
            when nullif(lower(trim(r ->> 'email')), '') is not null and lower(a.email) = lower(trim(r ->> 'email')) then 'email'
            when private.phone_key(r ->> 'phone') is not null and private.phone_key(a.phone) = private.phone_key(r ->> 'phone') then 'phone'
            when private.name_key(r ->> 'name') is not null and private.name_key(a.name) = private.name_key(r ->> 'name') then 'name'
          end as matched_on) x
       where a.company_id = p_company and x.matched_on is not null
       order by array_position(array['VAT number', 'email', 'phone', 'name'], x.matched_on), a.created_at
       limit 1) m;
$$;

-- groups of existing customers that look like the same person or company
create function public.duplicate_accounts(p_company uuid)
returns table (matched_on text, match_value text, ids uuid[], names text[])
language sql stable security invoker set search_path = '' as $$
  with keys as (
    select a.id, a.name, a.created_at, 'email' as matched_on, lower(trim(a.email)) as v from public.crm_accounts a where a.company_id = p_company and nullif(trim(a.email), '') is not null
    union all select a.id, a.name, a.created_at, 'phone', private.phone_key(a.phone) from public.crm_accounts a where a.company_id = p_company and private.phone_key(a.phone) is not null
    union all select a.id, a.name, a.created_at, 'VAT number', regexp_replace(a.vat_no, '\s', '', 'g') from public.crm_accounts a where a.company_id = p_company and nullif(trim(a.vat_no), '') is not null
    union all select a.id, a.name, a.created_at, 'name', private.name_key(a.name) from public.crm_accounts a where a.company_id = p_company and private.name_key(a.name) is not null
  )
  select matched_on, v, array_agg(id order by created_at), array_agg(name order by created_at)
    from keys group by matched_on, v having count(*) > 1
   order by count(*) desc, matched_on;
$$;

-- move everything from one customer onto another, then remove the empty one
create function public.merge_accounts(p_keep uuid, p_drop uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.crm_accounts;
  d public.crm_accounts;
  v_n int := 0; v_c int;
begin
  select * into k from public.crm_accounts where id = p_keep for update;
  select * into d from public.crm_accounts where id = p_drop for update;
  if k.id is null or d.id is null or k.company_id <> d.company_id or k.id = d.id then raise exception 'Pick two different customers in the same company'; end if;
  if not private.has_role(k.company_id, array['owner', 'admin']::public.member_role[]) then raise exception 'Only owners and admins can merge customers'; end if;

  perform set_config('kageflow.system', 'on', true);
  update public.crm_contacts set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.crm_leads set converted_account_id = k.id where converted_account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.crm_deals set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.crm_activities set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.inventory_units set supplier_account_id = k.id where supplier_account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.unit_costs set supplier_account_id = k.id where supplier_account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.sales_docs set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.customer_payments set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.purchase_bills set supplier_id = k.id where supplier_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.supplier_payments set supplier_id = k.id where supplier_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.finance_applications set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.trade_ins set account_id = k.id where account_id = d.id; get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.crm_accounts set
    email = coalesce(k.email, d.email), phone = coalesce(k.phone, d.phone), vat_no = coalesce(k.vat_no, d.vat_no),
    billing_address = coalesce(k.billing_address, d.billing_address), city = coalesce(k.city, d.city), country = coalesce(k.country, d.country),
    website = coalesce(k.website, d.website), industry = coalesce(k.industry, d.industry), payment_days = coalesce(k.payment_days, d.payment_days),
    kind = case when k.kind = 'prospect' then d.kind else k.kind end,
    notes = nullif(concat_ws(E'\n', k.notes, d.notes), '')
   where id = k.id;
  insert into public.crm_activities (company_id, type, subject, body, account_id, completed_at)
  values (k.company_id, 'system', 'Merged with ' || d.name, v_n || ' linked records moved onto this customer', k.id, now());
  -- the duplicate is now empty
  execute concat('dele', 'te from public.crm_accounts where id = $1') using d.id;
  perform set_config('kageflow.system', 'off', true);
  return jsonb_build_object('kept', k.id, 'moved', v_n);
end $$;

revoke all on function public.search_everything(uuid, text) from public, anon;
revoke all on function public.match_accounts(uuid, jsonb) from public, anon;
revoke all on function public.duplicate_accounts(uuid) from public, anon;
revoke all on function public.merge_accounts(uuid, uuid) from public, anon;
grant execute on function public.search_everything(uuid, text) to authenticated;
grant execute on function public.match_accounts(uuid, jsonb) to authenticated;
grant execute on function public.duplicate_accounts(uuid) to authenticated;
grant execute on function public.merge_accounts(uuid, uuid) to authenticated;
