-- Push Kageflow adverts to a connected website.
-- Every change to a published car (and the moment it's unpublished or sold) sends a signed
-- "listing.updated" webhook with the whole listing and its photo links. The website upserts it.
-- Cars that came from the website keep using "unit.updated" (the site owns their details).

create or replace function private.listing_payload(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  u public.inventory_units;
  v_listed boolean;
begin
  select * into u from public.inventory_units where id = p_unit;
  if u.id is null then return null; end if;
  v_listed := u.is_published and u.status in ('in_stock', 'listed', 'reserved', 'in_transit');
  return jsonb_build_object(
    'id', u.id,
    'stock_no', u.stock_no,
    'vin', case when u.vin_confirmed then u.serial_no end,
    'make', u.make, 'model', u.model, 'variant', u.variant, 'year', u.year,
    'mileage_km', u.mileage_km, 'colour', u.colour,
    'transmission', u.transmission, 'fuel_type', u.fuel_type, 'body_type', u.body_type,
    'condition', case when u.is_second_hand then 'used' else 'new' end,
    'price', coalesce(u.advert_price, u.list_price), 'currency', u.list_currency,
    'title', coalesce(nullif(trim(u.advert_title), ''), concat_ws(' ', u.year, u.make, u.model, u.variant)),
    'description', coalesce(u.advert_description, u.description),
    'features', coalesce(to_jsonb(u.features), '[]'::jsonb),
    'location', u.location,
    'kageflow_status', u.status,
    'listed', v_listed,
    -- what the website should show: hidden unless published and available
    'status', case when v_listed and u.status = 'reserved' then 'reserved'
                   when v_listed then 'available'
                   when u.status = 'sold' then 'sold'
                   else 'hidden' end,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'url', p.url, 'position', p.position) order by p.position, p.created_at)
                          from public.vehicle_photos p where p.unit_id = u.id),
                       case when u.image_url is not null then jsonb_build_array(jsonb_build_object('id', u.id, 'url', u.image_url, 'position', 0)) else '[]'::jsonb end),
    'updated_at', u.updated_at);
end $$;

create or replace function private.emit_listing(p_unit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u public.inventory_units;
begin
  select * into u from public.inventory_units where id = p_unit;
  if u.id is null then return; end if;
  -- the website already has its own cars; their status goes out as unit.updated
  if u.external_id is not null and u.external_source_id is not null then return; end if;
  perform private.emit_event(u.company_id, 'listing.updated', private.listing_payload(u.id));
end $$;

create or replace function private.unit_listing_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_published then perform private.emit_listing(new.id); end if;
    return null;
  end if;
  if not (new.is_published or old.is_published) then return null; end if;
  if row(new.is_published, new.status, new.advert_price, new.list_price, new.list_currency, new.make, new.model, new.variant, new.year,
         new.mileage_km, new.colour, new.transmission, new.fuel_type, new.body_type, new.advert_title, new.advert_description,
         new.description, new.features, new.location, new.stock_no, new.image_url, new.vin_confirmed, new.serial_no)
     is distinct from
     row(old.is_published, old.status, old.advert_price, old.list_price, old.list_currency, old.make, old.model, old.variant, old.year,
         old.mileage_km, old.colour, old.transmission, old.fuel_type, old.body_type, old.advert_title, old.advert_description,
         old.description, old.features, old.location, old.stock_no, old.image_url, old.vin_confirmed, old.serial_no) then
    perform private.emit_listing(new.id);
  end if;
  return null;
end $$;

create trigger inventory_units_push_listing after insert or update on public.inventory_units
  for each row execute function private.unit_listing_event();

create or replace function private.photo_listing_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_unit uuid := coalesce(new.unit_id, old.unit_id);
begin
  if exists (select 1 from public.inventory_units where id = v_unit and is_published) then
    perform private.emit_listing(v_unit);
  end if;
  return null;
end $$;

create trigger vehicle_photos_push_listing after insert or update or delete on public.vehicle_photos
  for each row execute function private.photo_listing_event();

-- Send every published car now: for a website that has just been connected
create or replace function public.push_listings(p_company uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can push stock to the website';
  end if;
  if not exists (select 1 from public.webhook_endpoints where company_id = p_company and is_active and 'listing.updated' = any (events)) then
    raise exception 'Add a webhook with the listing.updated event first';
  end if;
  for v_id in
    select id from public.inventory_units
     where company_id = p_company and is_published and status in ('in_stock', 'listed', 'reserved', 'in_transit')
       and not (external_id is not null and external_source_id is not null)
  loop
    perform private.emit_listing(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.push_listings(uuid) from public, anon;
grant execute on function public.push_listings(uuid) to authenticated;
revoke all on function private.listing_payload(uuid) from public;
revoke all on function private.emit_listing(uuid) from public;

-- Pulling from the website must not import the cars Kageflow pushed there (the website stores them under the Kageflow id)
do $$
declare
  v_def text := pg_get_functiondef('private.apply_stock_feed(uuid, jsonb)'::regprocedure);
  v_old text := 'if coalesce(n ->> ''external_id'', '''') = '''' then v_skipped := v_skipped + 1; continue; end if;';
begin
  if position(v_old in v_def) = 0 then raise exception 'apply_stock_feed: anchor not found'; end if;
  v_def := replace(v_def, v_old, v_old || '
    if exists (select 1 from public.inventory_units x where x.company_id = s.company_id and x.id::text = n ->> ''external_id'') then continue; end if;');
  execute v_def;
end $$;
