-- Give shipping/delivery addresses their own legal company and GSTIN.
-- Existing delivery rows remain unchanged and may have NULL transitional values.
alter table public.site_delivery_locations
  add column if not exists company_id uuid references public.companies(id) on delete restrict,
  add column if not exists gstin text;

create index if not exists site_delivery_locations_company_idx
  on public.site_delivery_locations(company_id, status);

-- Replace the 190009 trigger function while retaining its trigger name.
-- Billing and shipping companies may differ; only organization ownership applies.
create or replace function public.validate_site_delivery_location_billing_scope()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.billing_address_id is not null and not exists (
    select 1 from public.company_billing_addresses b
    where b.id = new.billing_address_id
      and b.organization_id = new.organization_id
  ) then
    raise exception 'Delivery location billing parent does not match its organization.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_site_delivery_location_company_scope()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.companies c
    where c.id = new.company_id and c.organization_id = new.organization_id
  ) then
      raise exception 'Shipping company does not belong to the supplied organization.';
  end if;
  if nullif(btrim(new.gstin), '') is not null and upper(btrim(new.gstin)) !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Invalid Shipping GSTIN format.';
  end if;
  if new.gstin is not null then new.gstin := upper(btrim(new.gstin)); end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_site_delivery_location_company_scope on public.site_delivery_locations;
create trigger trg_validate_site_delivery_location_company_scope
before insert or update of company_id, organization_id, gstin
on public.site_delivery_locations
for each row execute function public.validate_site_delivery_location_company_scope();

create or replace function public.save_procurement_address_with_contacts_atomic(
  p_kind text, p_organization_id uuid, p_parent_id uuid, p_parent jsonb, p_contacts jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_parent_id uuid := p_parent_id;
  v_contact jsonb;
  v_primary_count integer := 0;
  v_legacy_address text;
begin
  if p_kind not in ('billing_address', 'delivery_location') then raise exception 'Unsupported address type.'; end if;
  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then raise exception 'Contacts must be an array.'; end if;
  for v_contact in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) loop
    if nullif(btrim(v_contact->>'contact_name'), '') is null then raise exception 'Contact Person Name is required.'; end if;
    if coalesce((v_contact->>'is_primary')::boolean, false) and coalesce(v_contact->>'status', 'active') = 'active' then v_primary_count := v_primary_count + 1; end if;
  end loop;
  if v_primary_count > 1 then raise exception 'Only one active Primary Contact is allowed per address.'; end if;

  if p_kind = 'billing_address' then
    if not exists (select 1 from public.companies c where c.id=(p_parent->>'company_id')::uuid and c.organization_id=p_organization_id and coalesce(c.status,'active')='active') then raise exception 'Company is outside the supplied organization.'; end if;
    if v_parent_id is null then
      insert into public.company_billing_addresses(organization_id,company_id,label,address_line1,address_line2,city,state,pincode,gstin,is_default,status)
      values(p_organization_id,(p_parent->>'company_id')::uuid,nullif(p_parent->>'label',''),nullif(p_parent->>'address_line1',''),nullif(p_parent->>'address_line2',''),nullif(p_parent->>'city',''),nullif(p_parent->>'state',''),nullif(p_parent->>'pincode',''),nullif(upper(p_parent->>'gstin'),''),coalesce((p_parent->>'is_default')::boolean,false),coalesce(p_parent->>'status','active')) returning id into v_parent_id;
    else
      update public.company_billing_addresses set company_id=(p_parent->>'company_id')::uuid,label=nullif(p_parent->>'label',''),address_line1=nullif(p_parent->>'address_line1',''),address_line2=nullif(p_parent->>'address_line2',''),city=nullif(p_parent->>'city',''),state=nullif(p_parent->>'state',''),pincode=nullif(p_parent->>'pincode',''),gstin=nullif(upper(p_parent->>'gstin'),''),is_default=coalesce((p_parent->>'is_default')::boolean,false),status=coalesce(p_parent->>'status','active'),updated_at=now() where id=v_parent_id and organization_id=p_organization_id;
      if not found then raise exception 'Billing address was not found in your organization.'; end if;
    end if;
  else
    if not exists (select 1 from public.sites s where s.id=(p_parent->>'site_id')::uuid and s.organization_id=p_organization_id and coalesce(s.status,'active')='active') then raise exception 'Site is outside the supplied organization.'; end if;
    if not exists (select 1 from public.companies c where c.id=(p_parent->>'company_id')::uuid and c.organization_id=p_organization_id and coalesce(c.status,'active')='active') then raise exception 'Shipping company is outside the supplied organization.'; end if;
    if nullif(p_parent->>'billing_address_id','') is not null and not exists (select 1 from public.company_billing_addresses b where b.id=(p_parent->>'billing_address_id')::uuid and b.organization_id=p_organization_id) then raise exception 'Billing association is outside the supplied organization.'; end if;
    v_legacy_address := nullif(concat_ws(', ',nullif(p_parent->>'address_line1',''),nullif(p_parent->>'address_line2',''),nullif(p_parent->>'city',''),nullif(p_parent->>'state',''),nullif(p_parent->>'pincode','')),'');
    if v_parent_id is null then
      insert into public.site_delivery_locations(organization_id,company_id,gstin,site_id,billing_address_id,location_name,address,address_line1,address_line2,city,state,pincode,is_default,status)
      values(p_organization_id,(p_parent->>'company_id')::uuid,upper(nullif(p_parent->>'gstin','')),(p_parent->>'site_id')::uuid,nullif(p_parent->>'billing_address_id','')::uuid,nullif(p_parent->>'location_name',''),coalesce(v_legacy_address,nullif(p_parent->>'address','')),nullif(p_parent->>'address_line1',''),nullif(p_parent->>'address_line2',''),nullif(p_parent->>'city',''),nullif(p_parent->>'state',''),nullif(p_parent->>'pincode',''),coalesce((p_parent->>'is_default')::boolean,false),coalesce(p_parent->>'status','active')) returning id into v_parent_id;
    else
      update public.site_delivery_locations set company_id=(p_parent->>'company_id')::uuid,gstin=upper(nullif(p_parent->>'gstin','')),site_id=(p_parent->>'site_id')::uuid,location_name=nullif(p_parent->>'location_name',''),address=coalesce(v_legacy_address,nullif(p_parent->>'address','')),address_line1=nullif(p_parent->>'address_line1',''),address_line2=nullif(p_parent->>'address_line2',''),city=nullif(p_parent->>'city',''),state=nullif(p_parent->>'state',''),pincode=nullif(p_parent->>'pincode',''),is_default=coalesce((p_parent->>'is_default')::boolean,false),status=coalesce(p_parent->>'status','active'),updated_at=now() where id=v_parent_id and organization_id=p_organization_id;
      if not found then raise exception 'Delivery address was not found in your organization.'; end if;
    end if;
  end if;

  if p_kind='billing_address' then
    update public.procurement_address_contacts set is_primary=false where billing_address_id=v_parent_id and status='active';
    update public.procurement_address_contacts c set status='inactive',is_primary=false,updated_at=now() where c.billing_address_id=v_parent_id and c.status='active' and not exists(select 1 from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) x where nullif(x->>'id','')::uuid=c.id);
  else
    update public.procurement_address_contacts set is_primary=false where delivery_location_id=v_parent_id and status='active';
    update public.procurement_address_contacts c set status='inactive',is_primary=false,updated_at=now() where c.delivery_location_id=v_parent_id and c.status='active' and not exists(select 1 from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) x where nullif(x->>'id','')::uuid=c.id);
  end if;
  for v_contact in select * from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) loop
    if nullif(v_contact->>'id','') is null then
      insert into public.procurement_address_contacts(organization_id,billing_address_id,delivery_location_id,contact_name,designation,mobile,email,is_primary,status,sort_order)
      values(p_organization_id,case when p_kind='billing_address' then v_parent_id end,case when p_kind='delivery_location' then v_parent_id end,nullif(btrim(v_contact->>'contact_name'),''),nullif(v_contact->>'designation',''),nullif(v_contact->>'mobile',''),nullif(lower(v_contact->>'email'),''),coalesce((v_contact->>'is_primary')::boolean,false),coalesce(v_contact->>'status','active'),coalesce((v_contact->>'sort_order')::integer,0));
    else
      update public.procurement_address_contacts set contact_name=nullif(btrim(v_contact->>'contact_name'),''),designation=nullif(v_contact->>'designation',''),mobile=nullif(v_contact->>'mobile',''),email=nullif(lower(v_contact->>'email'),''),is_primary=coalesce((v_contact->>'is_primary')::boolean,false),status=coalesce(v_contact->>'status','active'),sort_order=coalesce((v_contact->>'sort_order')::integer,0),updated_at=now() where id=(v_contact->>'id')::uuid and organization_id=p_organization_id and ((p_kind='billing_address' and billing_address_id=v_parent_id) or (p_kind='delivery_location' and delivery_location_id=v_parent_id));
      if not found then raise exception 'Contact does not belong to this address.'; end if;
    end if;
  end loop;
  if p_kind='billing_address' then
    update public.company_billing_addresses b set contact_name=(select c.contact_name from public.procurement_address_contacts c where c.billing_address_id=v_parent_id and c.status='active' and c.is_primary),mobile=(select c.mobile from public.procurement_address_contacts c where c.billing_address_id=v_parent_id and c.status='active' and c.is_primary),email=(select c.email from public.procurement_address_contacts c where c.billing_address_id=v_parent_id and c.status='active' and c.is_primary),updated_at=now() where b.id=v_parent_id;
  else
    update public.site_delivery_locations d set contact_name=(select c.contact_name from public.procurement_address_contacts c where c.delivery_location_id=v_parent_id and c.status='active' and c.is_primary),mobile=(select c.mobile from public.procurement_address_contacts c where c.delivery_location_id=v_parent_id and c.status='active' and c.is_primary),email=(select c.email from public.procurement_address_contacts c where c.delivery_location_id=v_parent_id and c.status='active' and c.is_primary),updated_at=now() where d.id=v_parent_id;
  end if;
  return jsonb_build_object('id',v_parent_id);
end;
$$;

revoke all on function public.save_procurement_address_with_contacts_atomic(text,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_procurement_address_with_contacts_atomic(text,uuid,uuid,jsonb,jsonb) to service_role;
