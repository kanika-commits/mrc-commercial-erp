-- Forward-only reusable company GST registrations and site contacts.
-- This migration creates capability only and does not modify business rows.
create table if not exists public.company_gst_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  gstin text not null,
  legal_name text,
  trade_name text,
  state text,
  state_code text,
  registration_type text,
  effective_from date,
  effective_to date,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_gst_registrations_gstin_format_check check (upper(btrim(gstin)) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  constraint company_gst_registrations_dates_check check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index if not exists company_gst_registrations_org_gstin_uidx
  on public.company_gst_registrations(organization_id, upper(btrim(gstin)));
create unique index if not exists company_gst_registrations_one_default_idx
  on public.company_gst_registrations(company_id)
  where is_default and status = 'active';
create index if not exists company_gst_registrations_company_status_idx
  on public.company_gst_registrations(company_id, status);

alter table public.company_billing_addresses
  add column if not exists gst_registration_id uuid references public.company_gst_registrations(id) on delete restrict;
create index if not exists company_billing_addresses_gst_registration_idx
  on public.company_billing_addresses(gst_registration_id, status);

create unique index if not exists site_contacts_one_active_default_idx
  on public.site_contacts(site_id)
  where is_default and status = 'active';

create or replace function public.save_procurement_billing_address_with_gst_atomic(
  p_organization_id uuid, p_parent_id uuid, p_parent jsonb, p_contacts jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := p_parent_id;
  v_existing_org uuid;
  v_existing_company uuid;
  v_gst record;
  v_contact jsonb;
begin
  if v_id is not null then
    select organization_id, company_id into v_existing_org, v_existing_company from public.company_billing_addresses where id=v_id;
    if v_existing_org is null or v_existing_org <> p_organization_id then raise exception 'Billing address was not found in your organization.'; end if;
    if v_existing_company <> (p_parent->>'company_id')::uuid then raise exception 'Company cannot be changed for an existing billing address.'; end if;
  end if;
  if not exists (select 1 from public.companies where id=(p_parent->>'company_id')::uuid and organization_id=p_organization_id and coalesce(status,'active')='active') then
    raise exception 'Company is outside the supplied organization.';
  end if;
  if nullif(p_parent->>'gst_registration_id','') is not null then
    select id, organization_id, company_id, gstin, status into v_gst
      from public.company_gst_registrations
     where id=(p_parent->>'gst_registration_id')::uuid
       and organization_id=p_organization_id
       and company_id=(p_parent->>'company_id')::uuid
       and status='active';
    if not found then raise exception 'Selected GST registration is invalid for this company.'; end if;
  end if;
  if v_id is null then
    insert into public.company_billing_addresses(organization_id,company_id,label,address_line1,address_line2,city,state,pincode,gstin,gst_registration_id,is_default,status)
    values(p_organization_id,(p_parent->>'company_id')::uuid,nullif(p_parent->>'label',''),nullif(p_parent->>'address_line1',''),nullif(p_parent->>'address_line2',''),nullif(p_parent->>'city',''),nullif(p_parent->>'state',''),nullif(p_parent->>'pincode',''),coalesce(v_gst.gstin,nullif(upper(p_parent->>'gstin'),'')),v_gst.id,coalesce((p_parent->>'is_default')::boolean,false),coalesce(p_parent->>'status','active')) returning id into v_id;
  else
    update public.company_billing_addresses set label=nullif(p_parent->>'label',''),address_line1=nullif(p_parent->>'address_line1',''),address_line2=nullif(p_parent->>'address_line2',''),city=nullif(p_parent->>'city',''),state=nullif(p_parent->>'state',''),pincode=nullif(p_parent->>'pincode',''),gstin=coalesce(v_gst.gstin,nullif(upper(p_parent->>'gstin'),'')),gst_registration_id=v_gst.id,is_default=coalesce((p_parent->>'is_default')::boolean,false),status=coalesce(p_parent->>'status','active'),updated_at=now() where id=v_id and organization_id=p_organization_id;
    if not found then raise exception 'Billing address was not found in your organization.'; end if;
  end if;
  update public.procurement_address_contacts set is_primary=false where billing_address_id=v_id and status='active';
  update public.procurement_address_contacts c set status='inactive',is_primary=false,updated_at=now() where c.billing_address_id=v_id and c.status='active' and not exists (select 1 from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) x where nullif(x->>'id','')::uuid=c.id);
  for v_contact in select * from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) loop
    if nullif(v_contact->>'id','') is null then
      insert into public.procurement_address_contacts(organization_id,billing_address_id,contact_name,designation,mobile,email,is_primary,status,sort_order) values(p_organization_id,v_id,nullif(btrim(v_contact->>'contact_name'),''),nullif(v_contact->>'designation',''),nullif(v_contact->>'mobile',''),nullif(lower(v_contact->>'email'),''),coalesce((v_contact->>'is_primary')::boolean,false),coalesce(v_contact->>'status','active'),coalesce((v_contact->>'sort_order')::integer,0));
    else
      update public.procurement_address_contacts set contact_name=nullif(btrim(v_contact->>'contact_name'),''),designation=nullif(v_contact->>'designation',''),mobile=nullif(v_contact->>'mobile',''),email=nullif(lower(v_contact->>'email'),''),is_primary=coalesce((v_contact->>'is_primary')::boolean,false),status=coalesce(v_contact->>'status','active'),sort_order=coalesce((v_contact->>'sort_order')::integer,0),updated_at=now() where id=(v_contact->>'id')::uuid and organization_id=p_organization_id and billing_address_id=v_id;
      if not found then raise exception 'Contact does not belong to this billing address.'; end if;
    end if;
  end loop;
  update public.company_billing_addresses set contact_name=(select contact_name from public.procurement_address_contacts where billing_address_id=v_id and status='active' and is_primary),mobile=(select mobile from public.procurement_address_contacts where billing_address_id=v_id and status='active' and is_primary),email=(select email from public.procurement_address_contacts where billing_address_id=v_id and status='active' and is_primary),updated_at=now() where id=v_id;
  return jsonb_build_object('id',v_id);
end; $$;

create or replace function public.save_company_gst_registration_atomic(
  p_organization_id uuid, p_id uuid, p_company_id uuid, p_gstin text,
  p_legal_name text, p_trade_name text, p_state text, p_state_code text,
  p_registration_type text, p_effective_from date, p_effective_to date,
  p_is_default boolean, p_status text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_gstin text := upper(btrim(coalesce(p_gstin, ''))); v_company_org uuid; v_existing_org uuid; v_existing_company uuid;
begin
  select organization_id into v_company_org from public.companies where id = p_company_id and status = 'active';
  if v_company_org is null or v_company_org <> p_organization_id then raise exception 'Company is outside the supplied organization.'; end if;
  if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Enter a valid GSTIN.'; end if;
  if p_effective_to is not null and p_effective_from is not null and p_effective_to < p_effective_from then raise exception 'GST registration end date cannot precede its start date.'; end if;
  if v_id is not null then
    select organization_id, company_id into v_existing_org, v_existing_company from public.company_gst_registrations where id=v_id;
    if v_existing_org is null or v_existing_org <> p_organization_id then raise exception 'GST registration was not found in your organization.'; end if;
    if v_existing_company <> p_company_id then raise exception 'Company cannot be changed for an existing GST registration.'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':company-gstin:' || v_gstin, 0));
  if exists (select 1 from public.company_gst_registrations where organization_id=p_organization_id and upper(btrim(gstin))=v_gstin and id is distinct from v_id) then raise exception 'This GSTIN already exists in the organization.'; end if;
  if coalesce(p_status, 'active') <> 'active' and coalesce(p_is_default, false) then raise exception 'Inactive GST registrations cannot be default.'; end if;
  if v_id is not null and coalesce(p_status, 'active') <> 'active' and exists (select 1 from public.company_gst_registrations where id=v_id and is_default and status='active') and exists (select 1 from public.company_gst_registrations where company_id=p_company_id and status='active' and id is distinct from v_id) then raise exception 'Choose another default GST registration before deactivating this one.'; end if;
  if coalesce(p_is_default, false) then update public.company_gst_registrations set is_default=false where company_id=p_company_id and status='active' and id is distinct from v_id; end if;
  if v_id is null then
    insert into public.company_gst_registrations(organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type,effective_from,effective_to,is_default,status)
    values(p_organization_id,p_company_id,v_gstin,nullif(btrim(p_legal_name),''),nullif(btrim(p_trade_name),''),nullif(btrim(p_state),''),nullif(btrim(p_state_code),''),nullif(btrim(p_registration_type),''),p_effective_from,p_effective_to,coalesce(p_is_default,false),coalesce(p_status,'active')) returning id into v_id;
  else
    update public.company_gst_registrations set gstin=v_gstin,legal_name=nullif(btrim(p_legal_name),''),trade_name=nullif(btrim(p_trade_name),''),state=nullif(btrim(p_state),''),state_code=nullif(btrim(p_state_code),''),registration_type=nullif(btrim(p_registration_type),''),effective_from=p_effective_from,effective_to=p_effective_to,is_default=coalesce(p_is_default,false),status=coalesce(p_status,'active'),updated_at=now() where id=v_id and organization_id=p_organization_id;
    if not found then raise exception 'GST registration was not found in your organization.'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.save_site_contact_atomic(
  p_organization_id uuid, p_id uuid, p_site_id uuid, p_contact_name text,
  p_designation text, p_mobile text, p_email text, p_contact_type text,
  p_is_default boolean, p_status text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id;
begin
  if not exists (select 1 from public.sites where id=p_site_id and organization_id=p_organization_id and coalesce(status,'active')='active') then raise exception 'Site is outside the supplied organization.'; end if;
  if nullif(btrim(p_contact_name),'') is null then raise exception 'Contact Name is required.'; end if;
  if coalesce(p_status, 'active') <> 'active' and coalesce(p_is_default, false) then raise exception 'Inactive site contacts cannot be default.'; end if;
  if v_id is not null and coalesce(p_status, 'active') <> 'active' and exists (select 1 from public.site_contacts where id=v_id and is_default and status='active') and exists (select 1 from public.site_contacts where site_id=p_site_id and status='active' and id is distinct from v_id) then raise exception 'Choose another default site contact before deactivating this one.'; end if;
  if coalesce(p_is_default,false) then update public.site_contacts set is_default=false where site_id=p_site_id and status='active' and id is distinct from v_id; end if;
  if v_id is null then
    insert into public.site_contacts(organization_id,site_id,contact_name,designation,mobile,email,contact_type,is_default,status)
    values(p_organization_id,p_site_id,btrim(p_contact_name),nullif(btrim(p_designation),''),nullif(btrim(p_mobile),''),nullif(lower(btrim(p_email)),''),coalesce(nullif(btrim(p_contact_type),''),'other'),coalesce(p_is_default,false),coalesce(p_status,'active')) returning id into v_id;
  else
    update public.site_contacts set site_id=p_site_id,contact_name=btrim(p_contact_name),designation=nullif(btrim(p_designation),''),mobile=nullif(btrim(p_mobile),''),email=nullif(lower(btrim(p_email)),''),contact_type=coalesce(nullif(btrim(p_contact_type),''),'other'),is_default=coalesce(p_is_default,false),status=coalesce(p_status,'active'),updated_at=now() where id=v_id and organization_id=p_organization_id;
    if not found then raise exception 'Site contact was not found in your organization.'; end if;
  end if;
  return v_id;
end; $$;

revoke all on function public.save_company_gst_registration_atomic(uuid,uuid,uuid,text,text,text,text,text,text,date,date,boolean,text) from public, anon, authenticated;
grant execute on function public.save_company_gst_registration_atomic(uuid,uuid,uuid,text,text,text,text,text,text,date,date,boolean,text) to service_role;
revoke all on function public.save_site_contact_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.save_site_contact_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text) to service_role;
revoke all on function public.save_procurement_billing_address_with_gst_atomic(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_procurement_billing_address_with_gst_atomic(uuid,uuid,jsonb,jsonb) to service_role;
