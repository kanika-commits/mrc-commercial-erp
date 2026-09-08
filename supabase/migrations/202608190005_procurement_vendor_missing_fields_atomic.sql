-- Atomically complete only blank convenience fields for an existing Vendor.
-- The RPC is service-role-only; the application endpoint enforces Vendor edit permission and scope.
create or replace function public.complete_procurement_vendor_missing_fields_atomic(
  p_organization_id uuid,
  p_vendor_id uuid,
  p_fields jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor public.vendors%rowtype;
  v_contact public.vendor_contacts%rowtype;
  v_contact_count integer;
  v_primary_contact_count integer;
  v_address text := nullif(trim(coalesce(p_fields->>'address', '')), '');
  v_gstin text := upper(nullif(trim(coalesce(p_fields->>'gstin', '')), ''));
  v_phone text := regexp_replace(trim(coalesce(p_fields->>'phone', '')), '[^0-9]', '', 'g');
  v_email text := lower(nullif(trim(coalesce(p_fields->>'email', '')), ''));
  v_contact_name text := nullif(trim(coalesce(p_fields->>'contact_name', '')), '');
  v_pan text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':vendor-completion:' || p_vendor_id::text, 0));
  if v_gstin is not null then perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':gstin:' || v_gstin, 0)); end if;
  select * into v_vendor from public.vendors where id = p_vendor_id and organization_id = p_organization_id and coalesce(is_deleted, false) = false for update;
  if not found then raise exception 'Vendor was not found in the selected organization.' using errcode = '42501'; end if;
  if v_address is not null then
    if nullif(trim(coalesce(v_vendor.address, '')), '') is not null then raise exception 'Vendor address is already populated; use Vendor Master to change it.' using errcode = '22023'; end if;
    update public.vendors set address = v_address, updated_at = now() where id = p_vendor_id;
  end if;
  if v_gstin is not null then
    if nullif(trim(coalesce(v_vendor.gstin, '')), '') is not null or exists (select 1 from public.vendor_gstins where vendor_id = p_vendor_id and nullif(trim(gstin), '') is not null) then raise exception 'Vendor GSTIN is already populated; use Vendor Master to change it.' using errcode = '22023'; end if;
    if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Invalid GSTIN format.' using errcode = '22023'; end if;
    v_pan := upper(nullif(trim(coalesce(v_vendor.pan, '')), ''));
    if v_pan is not null and substring(v_gstin from 3 for 10) <> v_pan then raise exception 'GSTIN PAN does not match Vendor PAN.' using errcode = '22023'; end if;
    if exists (select 1 from public.vendors where organization_id = p_organization_id and id <> p_vendor_id and upper(trim(coalesce(gstin, ''))) = v_gstin and coalesce(is_deleted, false) = false) or exists (select 1 from public.vendor_gstins where organization_id = p_organization_id and upper(trim(gstin)) = v_gstin and vendor_id <> p_vendor_id) then raise exception 'This GSTIN already exists under another Vendor.' using errcode = '23505'; end if;
    update public.vendors set gstin = v_gstin, updated_at = now() where id = p_vendor_id;
    insert into public.vendor_gstins (organization_id, vendor_id, gstin, state_code, is_primary) values (p_organization_id, p_vendor_id, v_gstin, substring(v_gstin from 1 for 2), true);
  end if;
  select count(*) into v_contact_count from public.vendor_contacts where organization_id = p_organization_id and vendor_id = p_vendor_id;
  select count(*) into v_primary_contact_count from public.vendor_contacts where organization_id = p_organization_id and vendor_id = p_vendor_id and is_primary;
  if v_primary_contact_count > 1 then raise exception 'Vendor has multiple primary contacts; use Vendor Master.' using errcode = '22023'; end if;
  if v_contact_count > 1 and not exists (select 1 from public.vendor_contacts where organization_id = p_organization_id and vendor_id = p_vendor_id and is_primary) then raise exception 'Vendor has multiple contacts without a primary contact; use Vendor Master.' using errcode = '22023'; end if;
  select * into v_contact from public.vendor_contacts where organization_id = p_organization_id and vendor_id = p_vendor_id order by is_primary desc, created_at asc limit 1 for update;
  if found then
    if v_phone <> '' and nullif(trim(v_contact.contact_number), '') is not null then raise exception 'Vendor phone is already populated; use Vendor Master to change it.' using errcode = '22023'; end if;
    if v_email is not null and nullif(trim(coalesce(v_contact.email, '')), '') is not null then raise exception 'Vendor email is already populated; use Vendor Master to change it.' using errcode = '22023'; end if;
    if v_contact_name is not null and nullif(trim(coalesce(v_contact.contact_name, '')), '') is not null then raise exception 'Vendor contact name is already populated; use Vendor Master to change it.' using errcode = '22023'; end if;
    if v_phone <> '' or v_email is not null or v_contact_name is not null then update public.vendor_contacts set contact_number = case when nullif(trim(contact_number), '') is null and v_phone <> '' then v_phone else contact_number end, email = case when nullif(trim(coalesce(email, '')), '') is null and v_email is not null then v_email else email end, contact_name = case when nullif(trim(coalesce(contact_name, '')), '') is null and v_contact_name is not null then v_contact_name else contact_name end where id = v_contact.id; end if;
  elsif v_phone <> '' or v_email is not null or v_contact_name is not null then
    if v_phone = '' or v_contact_name is null then raise exception 'Contact Name and Phone are required to create a Vendor contact.' using errcode = '22023'; end if;
    insert into public.vendor_contacts (organization_id, vendor_id, contact_name, contact_number, email, is_primary) values (p_organization_id, p_vendor_id, v_contact_name, v_phone, v_email, true);
  end if;
  return jsonb_build_object('vendor_id', p_vendor_id, 'updated', true);
end;
$$;
revoke all on function public.complete_procurement_vendor_missing_fields_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_procurement_vendor_missing_fields_atomic(uuid, uuid, jsonb) to service_role;
