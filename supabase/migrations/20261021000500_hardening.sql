-- Kageflow 0005: run this ONCE in the Supabase SQL editor (Project kageflow > SQL Editor > New query > paste > Run).
-- The automated tool can't apply statements that remove data or rights, so these are applied by hand.
-- 1) remove_member lets owners/admins remove team members and lets a member leave a company.
-- 2) The revokes are defence in depth: RLS already blocks these actions; this also removes the table rights.

create or replace function public.remove_member(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current public.member_role;
begin
  if p_user <> auth.uid() and not private.has_role(p_company, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only owners and admins can remove members';
  end if;
  select role into v_current from public.company_members where company_id = p_company and user_id = p_user;
  if v_current is null then
    raise exception 'Not a member of this company';
  end if;
  if v_current = 'owner' and p_user <> auth.uid()
     and not private.has_role(p_company, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can remove an owner';
  end if;
  if v_current = 'owner'
     and (select count(*) from public.company_members where company_id = p_company and role = 'owner') = 1 then
    raise exception 'A company needs at least one owner';
  end if;
  delete from public.company_members where company_id = p_company and user_id = p_user;
end $$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

revoke delete, truncate on public.companies from authenticated;
revoke delete, truncate on public.company_members from authenticated;
revoke delete, truncate on public.profiles from authenticated;
revoke delete, truncate on public.audit_log from authenticated;
revoke delete, truncate on public.document_sequences from authenticated;
revoke truncate on all tables in schema public from authenticated, anon;
