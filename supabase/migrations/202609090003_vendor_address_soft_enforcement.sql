-- Soft Vendor Address enforcement for new Vendor Master records.
-- Existing nullable vendors.address rows remain valid and untouched.
create or replace function public.create_vendor_master_atomic(
  p_organization_id uuid, p_vendor jsonb, p_contacts jsonb, p_bank_accounts jsonb,
  p_gstins jsonb, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vendor record;
  v_vendor_name text := nullif(trim(p_vendor->>'vendor_name'), '');
  v_address text := nullif(trim(p_vendor->>'address'), '');
  v_gstin text := upper(trim(coalesce(p_vendor->>'gstin', '')));
begin
  if p_actor_user_id is null then raise exception 'Authenticated actor is required.' using errcode = '28000'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then raise exception 'Organization is invalid.' using errcode = '22023'; end if;
  if v_vendor_name is null then raise exception 'Vendor Name is required.' using errcode = '22023'; end if;
  if v_address is null then raise exception 'Vendor address is required.' using errcode = '22023'; end if;
  if not exists (select 1 from public.user_access_assignments where user_id = p_actor_user_id and organization_id = p_organization_id)
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_actor_user_id and r.role_code in ('platform_owner', 'super_admin')) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_permissions where user_id = p_actor_user_id and allowed = true and ((module_code = 'vendors' and action_code = 'add') or (module_code = '*' and action_code = '*')))
     and not exists (select 1 from public.role_permissions rp join public.user_roles ur on ur.role_id = rp.role_id where ur.user_id = p_actor_user_id and rp.allowed = true and ((rp.module_code = 'vendors' and rp.action_code = 'add') or (rp.module_code = '*' and rp.action_code = '*')))
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_actor_user_id and r.role_code in ('platform_owner', 'super_admin')) then
    raise exception 'You do not have permission to create vendors.' using errcode = '42501';
  end if;
  if v_gstin <> '' then
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':gstin:' || v_gstin, 0));
    if exists (select 1 from public.vendors where organization_id = p_organization_id and upper(trim(coalesce(gstin, ''))) = v_gstin and coalesce(is_deleted, false) = false)
       or exists (select 1 from public.vendor_gstins where organization_id = p_organization_id and upper(trim(gstin)) = v_gstin) then
      raise exception 'This GSTIN already exists.' using errcode = '23505';
    end if;
  end if;
  insert into public.vendors (organization_id, vendor_name, contractor_type, status, pan, aadhaar_cin, gstin, address, pan_aadhaar_link_status, msme_registered, msme_number, msme_category, profile_status)
  values (p_organization_id, v_vendor_name, p_vendor->>'contractor_type', p_vendor->>'status', p_vendor->>'pan', p_vendor->>'aadhaar_cin', nullif(v_gstin, ''), v_address, p_vendor->>'pan_aadhaar_link_status', coalesce((p_vendor->>'msme_registered')::boolean, false), nullif(trim(p_vendor->>'msme_number'), ''), nullif(trim(p_vendor->>'msme_category'), ''), 'complete') returning * into v_vendor;
  insert into public.vendor_contacts (organization_id, vendor_id, contact_name, contact_number, email, designation, is_primary)
  select p_organization_id, v_vendor.id, c.contact_name, c.contact_number, nullif(trim(c.email), ''), nullif(trim(c.designation), ''), c.is_primary from jsonb_to_recordset(coalesce(p_contacts, '[]'::jsonb)) as c(contact_name text, contact_number text, email text, designation text, is_primary boolean);
  insert into public.vendor_bank_accounts (organization_id, vendor_id, account_holder_name, account_number, ifsc_code, bank_name, branch_name, is_primary)
  select p_organization_id, v_vendor.id, b.account_holder_name, b.account_number, b.ifsc_code, b.bank_name, nullif(trim(b.branch_name), ''), b.is_primary from jsonb_to_recordset(coalesce(p_bank_accounts, '[]'::jsonb)) as b(account_holder_name text, account_number text, ifsc_code text, bank_name text, branch_name text, is_primary boolean);
  insert into public.vendor_gstins (organization_id, vendor_id, gstin, state_code, state_name, is_primary)
  select p_organization_id, v_vendor.id, upper(trim(g.gstin)), coalesce(g.state_code, left(upper(trim(g.gstin)), 2)), g.state_name, g.is_primary from jsonb_to_recordset(coalesce(p_gstins, '[]'::jsonb)) as g(gstin text, state_code text, state_name text, is_primary boolean) where nullif(trim(g.gstin), '') is not null;
  return jsonb_build_object('id', v_vendor.id, 'organization_id', v_vendor.organization_id, 'vendor_name', v_vendor.vendor_name, 'address', v_vendor.address, 'contractor_type', v_vendor.contractor_type, 'status', v_vendor.status, 'pan', v_vendor.pan, 'aadhaar_cin', v_vendor.aadhaar_cin, 'gstin', v_vendor.gstin, 'pan_aadhaar_link_status', v_vendor.pan_aadhaar_link_status, 'msme_registered', v_vendor.msme_registered, 'msme_number', v_vendor.msme_number, 'msme_category', v_vendor.msme_category);
end; $$;
revoke all on function public.create_vendor_master_atomic(uuid, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_vendor_master_atomic(uuid, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;
