-- Reusable Purchase Order master data. Apply manually after review.
alter table public.vendors add column if not exists address text;
alter table public.vendors add column if not exists profile_status text not null default 'complete';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_profile_status_check') then
    alter table public.vendors add constraint vendors_profile_status_check check (profile_status in ('basic', 'complete'));
  end if;
end $$;

create table if not exists public.company_billing_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  label text not null,
  address_line1 text not null,
  address_line2 text,
  city text,
  state text,
  pincode text,
  gstin text,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  contact_name text not null,
  designation text,
  mobile text,
  email text,
  contact_type text not null default 'delivery_receiving',
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_po_terms_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  template_name text not null,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_po_terms_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.company_po_terms_templates(id) on delete cascade,
  heading text not null,
  clause_body text not null,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create index if not exists company_billing_addresses_company_idx on public.company_billing_addresses(company_id, status);
create index if not exists site_contacts_site_idx on public.site_contacts(site_id, status);
create index if not exists company_po_terms_templates_company_idx on public.company_po_terms_templates(company_id, status);
create index if not exists company_po_terms_sections_template_idx on public.company_po_terms_sections(template_id, status, sort_order);

create index if not exists vendor_gstins_org_normalized_idx
  on public.vendor_gstins(organization_id, upper(trim(gstin)));
create index if not exists vendor_contacts_org_mobile_normalized_idx
  on public.vendor_contacts(organization_id, regexp_replace(contact_number, '[^0-9]', '', 'g'))
  where contact_number is not null;
create index if not exists vendor_contacts_org_email_normalized_idx
  on public.vendor_contacts(organization_id, lower(trim(email)))
  where email is not null;
create unique index if not exists company_billing_addresses_one_default_idx
  on public.company_billing_addresses(company_id) where is_default and status = 'active';
create unique index if not exists site_contacts_one_default_idx
  on public.site_contacts(site_id, contact_type) where is_default and status = 'active';
create unique index if not exists company_po_terms_templates_one_default_idx
  on public.company_po_terms_templates(company_id) where is_default and status = 'active';

create or replace function public.create_procurement_quick_vendor_atomic(
  p_organization_id uuid,
  p_vendor_name text,
  p_address text,
  p_mobile text,
  p_email text,
  p_gstin text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_vendor_name), '');
  v_address text := nullif(trim(p_address), '');
  v_mobile text := regexp_replace(trim(coalesce(p_mobile, '')), '[^0-9]', '', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
  v_gstin text := upper(trim(coalesce(p_gstin, '')));
  v_vendor_id uuid;
  v_mobile_matches jsonb := '[]'::jsonb;
  v_email_matches jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null then raise exception 'Authenticated actor is required.' using errcode = '28000'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then raise exception 'Organization is invalid.' using errcode = '22023'; end if;
  if not exists (select 1 from public.user_access_assignments where user_id = p_actor_user_id and organization_id = p_organization_id)
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_actor_user_id and r.role_code in ('platform_owner', 'super_admin')) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_permissions where user_id = p_actor_user_id and allowed = true and ((module_code = 'vendors' and action_code = 'add') or (module_code = '*' and action_code = '*')))
     and not exists (select 1 from public.role_permissions rp join public.user_roles ur on ur.role_id = rp.role_id where ur.user_id = p_actor_user_id and rp.allowed = true and ((rp.module_code = 'vendors' and rp.action_code = 'add') or (rp.module_code = '*' and rp.action_code = '*')))
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_actor_user_id and r.role_code in ('platform_owner', 'super_admin')) then
    raise exception 'You do not have permission to create vendors.' using errcode = '42501';
  end if;
  if v_name is null or v_address is null or v_mobile = '' or v_email = '' or v_gstin = '' then raise exception 'Vendor Name, Address, Mobile Number, Email and GSTIN are required.' using errcode = '22023'; end if;
  if v_mobile !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10 digit mobile number.' using errcode = '22023'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Enter a valid GSTIN.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':gstin:' || v_gstin, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':mobile:' || v_mobile, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':email:' || v_email, 0));
  if exists (select 1 from public.vendors where organization_id = p_organization_id and upper(trim(coalesce(gstin, ''))) = v_gstin and coalesce(is_deleted, false) = false) or exists (select 1 from public.vendor_gstins where organization_id = p_organization_id and upper(trim(gstin)) = v_gstin) then raise exception 'This GSTIN already exists.' using errcode = '23505'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'vendor_name', v.vendor_name)), '[]'::jsonb) into v_mobile_matches from public.vendor_contacts c join public.vendors v on v.id = c.vendor_id where c.organization_id = p_organization_id and regexp_replace(c.contact_number, '[^0-9]', '', 'g') = v_mobile and coalesce(v.is_deleted, false) = false;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'vendor_name', v.vendor_name)), '[]'::jsonb) into v_email_matches from public.vendor_contacts c join public.vendors v on v.id = c.vendor_id where c.organization_id = p_organization_id and lower(trim(c.email)) = v_email and coalesce(v.is_deleted, false) = false;
  insert into public.vendors (organization_id, vendor_name, contractor_type, status, gstin, is_deleted, address, profile_status)
    values (p_organization_id, v_name, 'proprietorship', 'active', v_gstin, false, v_address, 'basic') returning id into v_vendor_id;
  insert into public.vendor_contacts (organization_id, vendor_id, contact_name, contact_number, email, is_primary)
    values (p_organization_id, v_vendor_id, v_name, v_mobile, v_email, true);
  insert into public.vendor_gstins (organization_id, vendor_id, gstin, state_code, is_primary)
    values (p_organization_id, v_vendor_id, v_gstin, left(v_gstin, 2), true);
  return jsonb_build_object('id', v_vendor_id, 'vendor_id', v_vendor_id, 'vendor_name', v_name, 'profile_status', 'basic', 'mobile_matches', v_mobile_matches, 'email_matches', v_email_matches);
end;
$$;
revoke all on function public.create_procurement_quick_vendor_atomic(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_procurement_quick_vendor_atomic(uuid, text, text, text, text, text, uuid) to service_role;
