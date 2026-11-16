-- Keep Meta credentials inaccessible to authenticated PostgREST clients.
-- Server actions use the service-role client after checking company.manage.
revoke select on public.lead_channels from authenticated;
grant select (
  id, company_id, kind, name, token, is_active, phone_number_id, display_phone,
  verify_token, waba_id, auto_reply, assign_mode, last_received_at,
  received_count, created_at
) on public.lead_channels to authenticated;

revoke update on public.lead_channels from authenticated;
grant update (is_active) on public.lead_channels to authenticated;

revoke insert on public.lead_channels from authenticated;
grant insert (company_id, kind, name) on public.lead_channels to authenticated;
