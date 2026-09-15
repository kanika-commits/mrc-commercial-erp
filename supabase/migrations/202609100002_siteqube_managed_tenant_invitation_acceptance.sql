-- SiteQube Phase 4F additive invitation acceptance contract.
-- Draft only: do not apply until the invitation lifecycle is reviewed.
begin;
create or replace function public.accept_managed_tenant_invitation(p_invitation_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_invitation public.managed_tenant_invitations%rowtype; v_provisioning public.platform_organization_provisioning%rowtype; v_auth_email text; v_profile_name text; v_role_id uuid; v_membership_id uuid; v_next_status text; v_is_primary boolean;
begin
  if p_invitation_id is null or p_auth_user_id is null then raise exception 'Invitation and authenticated user are required.' using errcode = '22023'; end if;
  select email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) into v_auth_email, v_profile_name from auth.users where id = p_auth_user_id;
  if v_auth_email is null then raise exception 'Authenticated user was not found.' using errcode = '22023'; end if;
  select * into v_invitation from public.managed_tenant_invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation was not found.' using errcode = 'P0002'; end if;
  if v_invitation.status = 'accepted' and v_invitation.auth_user_id = p_auth_user_id then
    select id into v_membership_id from public.organization_memberships where organization_id = v_invitation.organization_id and user_id = p_auth_user_id;
    return jsonb_build_object('invitation_id', v_invitation.id, 'organization_id', v_invitation.organization_id, 'membership_id', v_membership_id, 'status', 'accepted');
  end if;
  if v_invitation.status not in ('pending', 'sent') then raise exception 'Invitation is not available for acceptance.' using errcode = '22023'; end if;
  if v_invitation.expires_at <= now() then update public.managed_tenant_invitations set status = 'expired', updated_at = now() where id = v_invitation.id; raise exception 'Invitation has expired.' using errcode = '22023'; end if;
  if lower(btrim(v_invitation.invited_email)) <> lower(btrim(v_auth_email)) then raise exception 'Authenticated email does not match the invitation.' using errcode = '42501'; end if;
  select * into v_provisioning from public.platform_organization_provisioning where id = v_invitation.provisioning_id for update;
  if not found or v_provisioning.organization_id <> v_invitation.organization_id or v_provisioning.status not in ('pending_admin', 'pending_domain') then raise exception 'Provisioning is not ready for invitation acceptance.' using errcode = '22023'; end if;
  if not exists (select 1 from public.organizations where id = v_invitation.organization_id and status = 'active') then raise exception 'Organization is not active.' using errcode = '22023'; end if;
  select not exists (select 1 from public.organization_memberships where user_id = p_auth_user_id and membership_status = 'active' and is_primary = true) into v_is_primary;
  insert into public.profiles (id, email, full_name, status) values (p_auth_user_id, lower(btrim(v_auth_email)), v_profile_name, 'active') on conflict (id) do update set email = coalesce(nullif(public.profiles.email, ''), excluded.email), full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name), status = coalesce(public.profiles.status, excluded.status);
  insert into public.organization_memberships (organization_id, user_id, membership_status, membership_type, is_primary, joined_at) values (v_invitation.organization_id, p_auth_user_id, 'active', 'tenant_administrator', v_is_primary, now()) on conflict (organization_id, user_id) do update set membership_status = 'active', membership_type = coalesce(public.organization_memberships.membership_type, excluded.membership_type), is_primary = public.organization_memberships.is_primary, joined_at = coalesce(public.organization_memberships.joined_at, excluded.joined_at), updated_at = now() returning id into v_membership_id;
  insert into public.managed_tenant_roles (organization_id, role_code, role_name) select v_invitation.organization_id, role_code, role_name from public.managed_tenant_role_templates where role_code = 'tenant_administrator' and status = 'active' on conflict (organization_id, role_code) do update set status = 'active' returning id into v_role_id;
  if v_role_id is null then select id into v_role_id from public.managed_tenant_roles where organization_id = v_invitation.organization_id and role_code = 'tenant_administrator' and status = 'active'; end if;
  insert into public.managed_tenant_role_permissions (role_id, module_code, action_code, allowed) select v_role_id, module_code, action_code, true from (select 'dashboard'::text module_code, 'view'::text action_code union all select 'administration', 'view' union all select 'administration', 'add' union all select 'administration', 'edit' union all select om.module_code, 'view' from public.organization_modules om where om.organization_id = v_invitation.organization_id and om.enabled and om.module_code not in ('dashboard', 'administration')) permissions on conflict (role_id, module_code, action_code) do nothing;
  insert into public.managed_tenant_user_roles (organization_id, membership_id, user_id, role_id) values (v_invitation.organization_id, v_membership_id, p_auth_user_id, v_role_id) on conflict (organization_id, user_id, role_id) do nothing;
  v_next_status := case when exists (select 1 from public.organization_domains where organization_id = v_invitation.organization_id and status = 'active') then 'ready' else 'pending_domain' end;
  update public.managed_tenant_invitations set status = 'accepted', auth_user_id = p_auth_user_id, accepted_at = now(), updated_at = now() where id = v_invitation.id;
  update public.platform_organization_provisioning set status = v_next_status, updated_at = now() where id = v_provisioning.id;
  insert into public.erp_audit_logs (organization_id, module_code, entity_type, record_id, action, description, source, created_by) values (v_invitation.organization_id, 'platform_organizations', 'managed_tenant_invitation', v_invitation.id, 'create', 'Managed tenant administrator invitation accepted.', 'api', p_auth_user_id);
  return jsonb_build_object('invitation_id', v_invitation.id, 'organization_id', v_invitation.organization_id, 'membership_id', v_membership_id, 'role_id', v_role_id, 'status', 'accepted', 'provisioning_status', v_next_status);
end; $$;
revoke all on function public.accept_managed_tenant_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_managed_tenant_invitation(uuid, uuid) to service_role;
commit;
