-- Kageflow 0012a: new lead sources (enum values need their own migration)
alter type public.crm_lead_source add value if not exists 'autotrader';
alter type public.crm_lead_source add value if not exists 'cars_co_za';
alter type public.crm_lead_source add value if not exists 'facebook';
alter type public.crm_lead_source add value if not exists 'email';
alter type public.crm_lead_source add value if not exists 'walk_in';
