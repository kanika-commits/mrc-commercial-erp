-- SiteQube forward-only provisioning reconciliation.
-- Adds only structures verified missing in production and installs the
-- application-facing branding/template provisioning overload.
begin;

create unique index if not exists managed_tenant_user_roles_org_id_unique
  on public.managed_tenant_user_roles (organization_id, id);

create unique index if not exists companies_org_id_unique
  on public.companies (organization_id, id);

create unique index if not exists sites_org_id_unique
  on public.sites (organization_id, id);

alter table public.managed_tenant_roles
  add column if not exists description text,
  add column if not exists source_platform_role_template_id uuid
    references public.platform_role_templates(id) on delete set null;

create index if not exists managed_tenant_roles_source_template_idx
  on public.managed_tenant_roles (source_platform_role_template_id);

create or replace function public.provision_managed_organization(
  p_request_key text, p_payload_hash text, p_organization_name text, p_organization_code text,
  p_company_name text, p_company_code text, p_module_codes text[], p_slug text, p_requested_by uuid,
  p_platform_role_template_ids uuid[], p_primary_admin_name text, p_primary_admin_email text,
  p_branding_display_name text, p_branding_login_tagline text,
  p_branding_primary_color text, p_branding_secondary_color text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_result jsonb;
  v_org_id uuid;
  v_invitation_id uuid;
  v_template public.platform_role_templates%rowtype;
  v_template_ids uuid[] := coalesce(p_platform_role_template_ids, '{}'::uuid[]);
  v_enabled text[] := coalesce(p_module_codes, '{}'::text[]);
  v_role_id uuid;
begin
  if nullif(btrim(p_primary_admin_name), '') is null
     or lower(btrim(p_primary_admin_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Primary administrator name and email are required.' using errcode = '22023';
  end if;

  if nullif(btrim(p_branding_display_name), '') is null
     or char_length(btrim(p_branding_login_tagline)) > 160
     or btrim(p_branding_primary_color) !~ '^#[0-9A-Fa-f]{6}$'
     or btrim(p_branding_secondary_color) !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Branding display name, tagline, and six-digit HEX colors are required.' using errcode = '22023';
  end if;

  if cardinality(v_template_ids) <> (select count(distinct id) from unnest(v_template_ids) id) then
    raise exception 'Duplicate platform role template ids are not allowed.' using errcode = '22023';
  end if;

  if coalesce(array_length(v_template_ids, 1), 0) <> (
    select count(*) from public.platform_role_templates where id = any(v_template_ids)
  ) then
    raise exception 'One or more selected platform role templates do not exist.' using errcode = '22023';
  end if;

  v_result := public.provision_managed_organization(
    p_request_key,
    p_payload_hash,
    p_organization_name,
    p_organization_code,
    p_company_name,
    p_company_code,
    p_module_codes,
    p_slug,
    p_requested_by
  );
  v_org_id := (v_result->>'organization_id')::uuid;

  insert into public.organization_branding (
    organization_id,
    organization_name,
    primary_color,
    secondary_color,
    login_tagline
  )
  values (
    v_org_id,
    btrim(p_branding_display_name),
    upper(btrim(p_branding_primary_color)),
    upper(btrim(p_branding_secondary_color)),
    btrim(p_branding_login_tagline)
  );

  if exists (
    select 1
    from public.platform_role_templates t
    where t.id = any(v_template_ids)
      and (t.status <> 'active' or t.is_tenant_admin_template)
  ) then
    raise exception 'Selected platform role template is inactive or reserved for tenant administration.' using errcode = '22023';
  end if;

  if coalesce(array_length(v_template_ids, 1), 0) > 0
     and exists (
       select 1
       from public.platform_role_template_permissions p
       join public.platform_role_templates t on t.id = p.role_template_id
       where t.id = any(v_template_ids)
         and not (p.module_code = any(v_enabled))
     ) then
    raise exception 'A selected role template contains a permission for a module not enabled for this organization.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.platform_role_templates
    where id = any(v_template_ids)
    group by template_key
    having count(*) > 1
  ) then
    raise exception 'Selected role templates would create a duplicate tenant role.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.platform_role_templates
    where id = any(v_template_ids)
      and template_key = 'tenant_administrator'
  ) then
    raise exception 'Tenant Administrator is created by the invitation workflow and cannot be cloned here.' using errcode = '23505';
  end if;

  for v_template in
    select *
    from public.platform_role_templates
    where id = any(v_template_ids)
      and status = 'active'
      and not is_tenant_admin_template
    order by sort_order, name
  loop
    insert into public.managed_tenant_roles (
      organization_id,
      role_code,
      role_name,
      description,
      source_platform_role_template_id
    )
    values (
      v_org_id,
      v_template.template_key,
      v_template.name,
      v_template.description,
      v_template.id
    )
    on conflict (organization_id, role_code) do update
      set role_name = excluded.role_name,
          description = excluded.description,
          source_platform_role_template_id = excluded.source_platform_role_template_id,
          status = 'active'
    returning id into v_role_id;

    insert into public.managed_tenant_role_permissions (
      role_id,
      module_code,
      action_code,
      allowed
    )
    select v_role_id, p.module_code, p.action_code, true
    from public.platform_role_template_permissions p
    where p.role_template_id = v_template.id
    on conflict (role_id, module_code, action_code) do update
      set allowed = true;
  end loop;

  insert into public.managed_tenant_invitations (
    provisioning_id,
    organization_id,
    invited_email,
    invited_name,
    status,
    invited_by,
    expires_at
  )
  values (
    (v_result->>'provisioning_id')::uuid,
    v_org_id,
    lower(btrim(p_primary_admin_email)),
    btrim(p_primary_admin_name),
    'pending',
    p_requested_by,
    now() + interval '7 days'
  )
  on conflict (organization_id, lower(invited_email)) where status in ('pending', 'sent') do update
    set invited_name = excluded.invited_name,
        invited_by = excluded.invited_by,
        expires_at = excluded.expires_at,
        updated_at = now()
  returning id into v_invitation_id;

  update public.platform_organization_provisioning
  set status = 'pending_admin', updated_at = now()
  where id = (v_result->>'provisioning_id')::uuid;

  return v_result || jsonb_build_object(
    'role_template_ids', v_template_ids,
    'invitation_id', v_invitation_id,
    'invitation_status', 'pending'
  );
end;
$$;

revoke all on function public.provision_managed_organization(
  text, text, text, text, text, text, text[], text, uuid,
  uuid[], text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.provision_managed_organization(
  text, text, text, text, text, text, text[], text, uuid,
  uuid[], text, text, text, text, text, text
) to service_role;

commit;
