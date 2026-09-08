CREATE OR REPLACE FUNCTION public.resolve_procurement_po_master_snapshot(
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_selection jsonb := coalesce(p_fields->'master_selection', '{}'::jsonb);

  v_delivery_location_id uuid :=
    nullif(v_selection->>'delivery_location_id', '')::uuid;

  v_billing_contact_id uuid :=
    coalesce(
      nullif(v_selection->>'billing_contact_id', '')::uuid,
      nullif(v_selection->>'site_contact_id', '')::uuid
    );

  v_delivery_contact_id uuid :=
    coalesce(
      nullif(v_selection->>'delivery_contact_id', '')::uuid,
      nullif(v_selection->>'site_contact_id', '')::uuid
    );

  v_gst public.company_gst_registrations%rowtype;
  v_billing public.company_billing_addresses%rowtype;
  v_delivery public.site_delivery_locations%rowtype;
  v_billing_contact public.site_contacts%rowtype;
  v_delivery_contact public.site_contacts%rowtype;

  v_delivery_company_name text;
  v_letterhead record;

  v_gst_count integer;
  v_gst_default_count integer;

  v_billing_count integer;

  v_delivery_count integer;
  v_delivery_default_count integer;

  v_site_contact_count integer;
  v_site_contact_default_count integer;

  v_billing_address text;
  v_delivery_address text;

begin

  if not exists (
    select 1
      from public.companies c
     where c.id = p_company_id
       and c.organization_id = p_organization_id
       and coalesce(c.status, 'active') = 'active'
  ) then
    raise exception 'Selected Company is inactive or outside the organization.';
  end if;

  if not exists (
    select 1
      from public.sites s
     where s.id = p_site_id
       and s.organization_id = p_organization_id
       and coalesce(s.status, 'active') = 'active'
  ) then
    raise exception 'Selected Site is inactive or outside the Company.';
  end if;

  select
    count(*),
    count(*) filter (where is_default)
  into
    v_gst_count,
    v_gst_default_count
  from public.company_gst_registrations
  where organization_id = p_organization_id
    and company_id = p_company_id
    and status = 'active';

  if v_gst_count = 0 then
    raise exception 'Configure an active GST/Billing Master for the selected Company.';

  elsif v_gst_default_count = 1 then

    select *
      into v_gst
      from public.company_gst_registrations
     where organization_id = p_organization_id
       and company_id = p_company_id
       and status = 'active'
       and is_default
     limit 1;

  elsif v_gst_count = 1 then

    select *
      into v_gst
      from public.company_gst_registrations
     where organization_id = p_organization_id
       and company_id = p_company_id
       and status = 'active'
     limit 1;

  else
    raise exception 'Configure exactly one default GST/Billing Master for the selected Company.';
  end if;

  select count(*)
    into v_billing_count
    from public.company_billing_addresses
   where organization_id = p_organization_id
     and company_id = p_company_id
     and status = 'active'
     and gst_registration_id = v_gst.id;

  if v_billing_count >= 1 then

    select *
      into v_billing
      from public.company_billing_addresses
     where organization_id = p_organization_id
       and company_id = p_company_id
       and status = 'active'
       and gst_registration_id = v_gst.id
     order by is_default desc, updated_at desc, id
     limit 1;

  else

    select count(*)
      into v_billing_count
      from public.company_billing_addresses
     where organization_id = p_organization_id
       and company_id = p_company_id
       and status = 'active'
       and gst_registration_id is null;

    if v_billing_count = 1 then

      select *
        into v_billing
        from public.company_billing_addresses
       where organization_id = p_organization_id
         and company_id = p_company_id
         and status = 'active'
         and gst_registration_id is null
       limit 1;

    else
      raise exception 'Configure one active Billing Address linked to the Company GST/Billing Master.';
    end if;

  end if;

  if v_delivery_location_id is not null then

    select *
      into v_delivery
      from public.site_delivery_locations
     where id = v_delivery_location_id
       and organization_id = p_organization_id
       and site_id = p_site_id
       and status = 'active'
       and billing_address_id = v_billing.id
       and (
         company_id is null
         or exists (
           select 1
             from public.companies c
            where c.id = site_delivery_locations.company_id
              and c.organization_id = p_organization_id
              and coalesce(c.status, 'active') = 'active'
         )
       );

    if v_delivery.id is null then
      raise exception 'Selected Delivery Location is inactive, outside the selected Site, or not linked to the selected GST/Billing setup.';
    end if;

  else

    select
      count(*),
      count(*) filter (where is_default)
    into
      v_delivery_count,
      v_delivery_default_count
    from public.site_delivery_locations
    where organization_id = p_organization_id
      and site_id = p_site_id
      and status = 'active'
      and billing_address_id = v_billing.id;

    if v_delivery_count = 0 then
      raise exception 'Configure an active Delivery Location linked to the selected GST/Billing setup for this Site.';

    elsif v_delivery_count = 1 then

      select *
        into v_delivery
        from public.site_delivery_locations
       where organization_id = p_organization_id
         and site_id = p_site_id
         and status = 'active'
         and billing_address_id = v_billing.id
       limit 1;

    elsif v_delivery_default_count = 1 then

      select *
        into v_delivery
        from public.site_delivery_locations
       where organization_id = p_organization_id
         and site_id = p_site_id
         and status = 'active'
         and billing_address_id = v_billing.id
         and is_default
       limit 1;

    else
      raise exception 'Select a Delivery Location for the selected Site.';
    end if;

  end if;

  if v_billing_contact_id is not null then

    select *
      into v_billing_contact
      from public.site_contacts
     where id = v_billing_contact_id
       and organization_id = p_organization_id
       and site_id = p_site_id
       and status = 'active';

    if v_billing_contact.id is null then
      raise exception 'Selected Billing Contact is inactive or outside the selected Site.';
    end if;

  else

    select
      count(*),
      count(*) filter (where is_default)
    into
      v_site_contact_count,
      v_site_contact_default_count
    from public.site_contacts
    where organization_id = p_organization_id
      and site_id = p_site_id
      and status = 'active';

    if v_site_contact_count = 0 then
      raise exception 'Configure an active Billing Contact for the selected Site.';

    elsif v_site_contact_count = 1 then

      select *
        into v_billing_contact
        from public.site_contacts
       where organization_id = p_organization_id
         and site_id = p_site_id
         and status = 'active'
       limit 1;

    elsif v_site_contact_default_count = 1 then

      select *
        into v_billing_contact
        from public.site_contacts
       where organization_id = p_organization_id
         and site_id = p_site_id
         and status = 'active'
         and is_default
       limit 1;

    else
      raise exception 'Select a Billing Contact for the selected Site.';
    end if;

  end if;

  if v_delivery_contact_id = v_billing_contact_id then
    v_delivery_contact := v_billing_contact;

  else

    select *
      into v_delivery_contact
      from public.site_contacts
     where id = v_delivery_contact_id
       and organization_id = p_organization_id
       and site_id = p_site_id
       and status = 'active';

    if v_delivery_contact.id is null then
      raise exception 'Selected Delivery Contact is inactive or outside the selected Site.';
    end if;

  end if;

  if v_delivery.company_id is not null then

    select c.company_name
      into v_delivery_company_name
      from public.companies c
     where c.id = v_delivery.company_id
       and c.organization_id = p_organization_id
       and coalesce(c.status, 'active') = 'active';

    if v_delivery_company_name is null then
      raise exception 'Delivery Location is linked to an inactive or outside-organization Company.';
    end if;

  end if;

  select
    l.id as letterhead_id,
    l.letterhead_name,
    l.company_id,

    v.id as version_id,
    v.version_number,
    v.page_size,

    v.header_storage_provider,
    v.header_storage_bucket,
    v.header_storage_key,
    v.header_original_file_name,
    v.header_mime_type,
    v.header_size_bytes,
    v.header_width_px,
    v.header_height_px,
    v.header_content_hash,

    v.footer_storage_provider,
    v.footer_storage_bucket,
    v.footer_storage_key,
    v.footer_original_file_name,
    v.footer_mime_type,
    v.footer_size_bytes,
    v.footer_width_px,
    v.footer_height_px,
    v.footer_content_hash,

    v.header_height_points,
    v.footer_height_points,
    v.content_margin_left_points,
    v.content_margin_right_points,
    v.content_gap_after_header_points,
    v.content_gap_before_footer_points

  into v_letterhead

  from public.procurement_company_letterheads l

  join public.procurement_company_letterhead_versions v
    on v.letterhead_id = l.id

  where l.organization_id = p_organization_id
    and l.company_id = p_company_id
    and l.status = 'active'
    and l.is_default
    and v.version_status = 'ready'
    and v.header_storage_key is not null
    and v.footer_storage_key is not null
    and v.header_content_hash is not null
    and v.footer_content_hash is not null

  order by v.version_number desc, v.id desc

  limit 1;

  if v_letterhead.version_id is null then
    raise exception 'Configure a default Ready Letterhead Master for the selected Company.';
  end if;

  v_billing_address :=
    concat_ws(
      ', ',
      v_billing.address_line1,
      v_billing.address_line2,
      v_billing.city,
      v_billing.state,
      v_billing.pincode
    );

  v_delivery_address :=
    coalesce(
      nullif(v_delivery.address, ''),
      concat_ws(
        ', ',
        v_delivery.address_line1,
        v_delivery.address_line2,
        v_delivery.city,
        v_delivery.state,
        v_delivery.pincode
      )
    );

  return jsonb_build_object(

    'master_selection',
    jsonb_build_object(
      'gst_registration_id', v_gst.id,
      'billing_address_id', v_billing.id,
      'delivery_location_id', v_delivery.id,
      'site_contact_id', v_delivery_contact.id,
      'billing_contact_id', v_billing_contact.id,
      'delivery_contact_id', v_delivery_contact.id,
      'letterhead_id', v_letterhead.letterhead_id,
      'letterhead_version_id', v_letterhead.version_id
    ),

    'gst_billing',
    jsonb_build_object(
      'gst_registration_id', v_gst.id,
      'billing_address_id', v_billing.id,
      'company_id', p_company_id,
      'gstin', upper(btrim(v_gst.gstin)),
      'legal_name', v_gst.legal_name,
      'trade_name', v_gst.trade_name,
      'state', coalesce(v_gst.state, v_billing.state),
      'state_code', v_gst.state_code,
      'registration_type', v_gst.registration_type,
      'label', v_billing.label,
      'address_line1', v_billing.address_line1,
      'address_line2', v_billing.address_line2,
      'city', v_billing.city,
      'pincode', v_billing.pincode,
      'address', v_billing_address,
      'contact_name', v_billing.contact_name,
      'mobile', v_billing.mobile,
      'email', v_billing.email
    ),

    'billing_address',
    jsonb_build_object(
      'id', v_billing.id,
      'company_id', p_company_id,
      'gst_registration_id', v_gst.id,
      'label', v_billing.label,
      'gstin', upper(btrim(v_gst.gstin)),
      'legal_name', v_gst.legal_name,
      'trade_name', v_gst.trade_name,
      'state', coalesce(v_gst.state, v_billing.state),
      'state_code', v_gst.state_code,
      'registration_type', v_gst.registration_type,
      'address_line1', v_billing.address_line1,
      'address_line2', v_billing.address_line2,
      'city', v_billing.city,
      'pincode', v_billing.pincode,
      'address', v_billing_address,
      'contact_name', v_billing.contact_name,
      'mobile', v_billing.mobile,
      'email', v_billing.email
    ),

    'delivery_location',
    jsonb_build_object(
      'id', v_delivery.id,
      'company_id', v_delivery.company_id,
      'company_name', v_delivery_company_name,
      'site_id', v_delivery.site_id,
      'billing_address_id', v_delivery.billing_address_id,
      'location_name', v_delivery.location_name,
      'gstin', v_delivery.gstin,
      'address_line1', v_delivery.address_line1,
      'address_line2', v_delivery.address_line2,
      'city', v_delivery.city,
      'state', v_delivery.state,
      'pincode', v_delivery.pincode,
      'address', v_delivery_address
    ),

    'site_contact',
    jsonb_build_object(
      'id', v_delivery_contact.id,
      'site_id', v_delivery_contact.site_id,
      'contact_name', v_delivery_contact.contact_name,
      'designation', v_delivery_contact.designation,
      'mobile', v_delivery_contact.mobile,
      'email', v_delivery_contact.email,
      'contact_type', v_delivery_contact.contact_type
    ),

    'delivery_contact',
    jsonb_build_object(
      'id', v_delivery_contact.id,
      'site_id', v_delivery_contact.site_id,
      'contact_name', v_delivery_contact.contact_name,
      'designation', v_delivery_contact.designation,
      'mobile', v_delivery_contact.mobile,
      'email', v_delivery_contact.email,
      'contact_type', v_delivery_contact.contact_type
    ),

    'billing_contact',
    jsonb_build_object(
      'id', v_billing_contact.id,
      'site_id', v_billing_contact.site_id,
      'contact_name', v_billing_contact.contact_name,
      'designation', v_billing_contact.designation,
      'mobile', v_billing_contact.mobile,
      'email', v_billing_contact.email,
      'contact_type', v_billing_contact.contact_type
    ),

    'letterhead',
    jsonb_build_object(
      'letterhead_id', v_letterhead.letterhead_id,
      'letterhead_name', v_letterhead.letterhead_name,
      'company_id', v_letterhead.company_id,
      'version_id', v_letterhead.version_id,
      'version_number', v_letterhead.version_number,
      'page_size', v_letterhead.page_size,

      'header_storage_provider', v_letterhead.header_storage_provider,
      'header_storage_bucket', v_letterhead.header_storage_bucket,
      'header_storage_key', v_letterhead.header_storage_key,
      'header_original_file_name', v_letterhead.header_original_file_name,
      'header_mime_type', v_letterhead.header_mime_type,
      'header_size_bytes', v_letterhead.header_size_bytes,
      'header_width_px', v_letterhead.header_width_px,
      'header_height_px', v_letterhead.header_height_px,
      'header_content_hash', v_letterhead.header_content_hash,

      'footer_storage_provider', v_letterhead.footer_storage_provider,
      'footer_storage_bucket', v_letterhead.footer_storage_bucket,
      'footer_storage_key', v_letterhead.footer_storage_key,
      'footer_original_file_name', v_letterhead.footer_original_file_name,
      'footer_mime_type', v_letterhead.footer_mime_type,
      'footer_size_bytes', v_letterhead.footer_size_bytes,
      'footer_width_px', v_letterhead.footer_width_px,
      'footer_height_px', v_letterhead.footer_height_px,
      'footer_content_hash', v_letterhead.footer_content_hash,

      'header_height_points', v_letterhead.header_height_points,
      'footer_height_points', v_letterhead.footer_height_points,
      'content_margin_left_points', v_letterhead.content_margin_left_points,
      'content_margin_right_points', v_letterhead.content_margin_right_points,
      'content_gap_after_header_points', v_letterhead.content_gap_after_header_points,
      'content_gap_before_footer_points', v_letterhead.content_gap_before_footer_points
    ),

    'gst_registration_id', v_gst.id,
    'billing_address_id', v_billing.id,
    'delivery_location_id', v_delivery.id,
    'site_contact_id', v_delivery_contact.id,
    'billing_contact_id', v_billing_contact.id,
    'delivery_contact_id', v_delivery_contact.id,

    'shipping_address',
    jsonb_build_object(
      'id', v_delivery.id,
      'location_name', v_delivery.location_name,
      'gstin', v_delivery.gstin,
      'address', v_delivery_address
    )

  );

end;
$function$;
