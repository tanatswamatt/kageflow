-- Customers who send a link to a car on AutoTrader, Cars.co.za and similar sites (website form, WhatsApp, email):
-- the link is kept on the lead, and the car's make, model and year are read from the link into "Interested in".

alter table public.crm_leads
  add column listing_url text check (listing_url is null or length(listing_url) <= 1000),
  add column listing_site text;

create or replace function private.listing_from_text(p_text text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_url text;
  v_host text;
  m text[];
  v_title text;
  v_site text;
begin
  v_url := (regexp_match(coalesce(p_text, ''),
    '(https?://(?:www\.|m\.)?(?:autotrader\.co\.za|cars\.co\.za|webuycars\.co\.za|carfind\.co\.za|gumtree\.co\.za|surf4cars\.co\.za|autotrader\.co\.zw|facebook\.com/marketplace|weelee\.co\.za|automark\.co\.za)[^\s<>"'']*)', 'i'))[1];
  if v_url is null then return null; end if;
  v_url := regexp_replace(v_url, '[).,;!?]+$', '');
  v_host := lower((regexp_match(v_url, '^https?://(?:www\.|m\.)?([^/]+)', 'i'))[1]);
  v_site := case
    when v_host like 'autotrader%' then 'AutoTrader'
    when v_host = 'cars.co.za' then 'Cars.co.za'
    when v_host = 'webuycars.co.za' then 'WeBuyCars'
    when v_host = 'facebook.com' then 'Facebook Marketplace'
    else initcap(split_part(v_host, '.', 1)) end;

  -- autotrader.co.za/car-for-sale/toyota/hilux/2.8-gd-6-raider-double-cab/27123456
  m := regexp_match(v_url, 'autotrader\.co\.(?:za|zw)/car-for-sale/([^/]+)/([^/]+)/([^/?#]+)/(\d+)', 'i');
  if m is not null then
    v_title := initcap(replace(m[1], '-', ' ')) || ' ' || initcap(replace(m[2], '-', ' ')) || ' ' || replace(m[3], '-', ' ');
  end if;
  -- cars.co.za/for-sale/used/2020-Toyota-Hilux-2.8-GD-6-Raider-Double-Cab-Gauteng-Pretoria/9123456/
  if v_title is null then
    m := regexp_match(v_url, 'cars\.co\.za/for-sale/(?:used|new|demo)/([^/?#]+)/(\d+)', 'i');
    if m is not null then
      v_title := replace(regexp_replace(m[1],
        '-(Gauteng|Western-Cape|Eastern-Cape|Northern-Cape|KwaZulu-Natal|Free-State|Limpopo|Mpumalanga|North-West)(-.*)?$', '', 'i'), '-', ' ');
    end if;
  end if;
  return jsonb_build_object('url', left(v_url, 1000), 'site', v_site, 'title', left(nullif(trim(v_title), ''), 200));
end $$;

do $$
declare
  v_def text := pg_get_functiondef('private.capture_lead(uuid, public.crm_lead_source, text, text, text, text, text, text, text, public.crm_activity_type, text, boolean)'::regprocedure);
  a text := '  if p_log or v_created then';
begin
  if position(a in v_def) = 0 then raise exception 'capture_lead: anchor not found'; end if;
  v_def := replace(v_def, a, '  -- a link to the car on AutoTrader, Cars.co.za and the like
  declare
    x jsonb := private.listing_from_text(v_text);
  begin
    if x is not null then
      update public.crm_leads
         set listing_url = coalesce(case when v_created then null else listing_url end, x ->> ''url''),
             listing_site = coalesce(case when v_created then null else listing_site end, x ->> ''site''),
             interest = case when v_created or interest is null then coalesce(left(v_interest, 500), x ->> ''title'', interest, ''Car on '' || (x ->> ''site''))
                             else interest end
       where id = v_lead;
    end if;
  end;

' || a);
  execute v_def;
end $$;

-- the API's "interest" is only a fallback now: a link's car comes first
do $$
declare
  v_def text := pg_get_functiondef('public.api_submit_lead(text, jsonb)'::regprocedure);
  a text := 'interest = coalesce(interest, left(v_interest, 500)),';
begin
  if position(a in v_def) = 0 then raise exception 'api_submit_lead: anchor not found'; end if;
  execute replace(v_def, a, 'interest = coalesce(interest, left(v_interest, 500)),
         listing_url = coalesce(listing_url, (private.listing_from_text(nullif(trim(p_lead ->> ''listing_url''), ''''))) ->> ''url''),
         listing_site = coalesce(listing_site, (private.listing_from_text(nullif(trim(p_lead ->> ''listing_url''), ''''))) ->> ''site''),');
end $$;
