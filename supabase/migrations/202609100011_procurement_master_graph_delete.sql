-- Permanently delete an unused GST/Billing/Delivery master graph atomically.
create or replace function public.delete_procurement_master_graph_atomic(
  p_organization_id uuid, p_kind text, p_id uuid, p_company_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_gst_id uuid; v_delivery_id uuid; v_row_org uuid; v_row_company uuid; v_count integer;
begin
  if p_kind = 'delivery_location' then
    select organization_id, company_id into v_row_org, v_row_company from public.site_delivery_locations where id = p_id for update;
    if v_row_org is null or v_row_org <> p_organization_id then raise exception 'Master record is outside the requested organization.' using errcode = 'P0001'; end if;
    select count(*) into v_count from public.procurement_purchase_orders where delivery_snapshot->>'delivery_location_id' = p_id::text or delivery_snapshot->'master_selection'->>'delivery_location_id' = p_id::text;
    if v_count > 0 then raise exception 'This Delivery Location is already used in Purchase Orders and cannot be deleted.' using errcode = 'P0001'; end if;
    delete from public.procurement_address_contacts where organization_id = p_organization_id and delivery_location_id = p_id;
    delete from public.site_delivery_locations where id = p_id and organization_id = p_organization_id;
    return jsonb_build_object('ok', true, 'deleted_kind', p_kind, 'deleted_id', p_id);
  end if;
  if p_kind = 'billing_address' then
    select organization_id, company_id, gst_registration_id into v_row_org, v_row_company, v_gst_id from public.company_billing_addresses where id = p_id for update;
    if v_row_org is null or v_row_org <> p_organization_id or (p_company_id is not null and v_row_company <> p_company_id) then raise exception 'Master record is outside the requested organization or company.' using errcode = 'P0001'; end if;
    select count(*) into v_count from public.procurement_purchase_orders where delivery_snapshot->>'billing_address_id' = p_id::text or delivery_snapshot->'master_selection'->>'billing_address_id' = p_id::text;
    if v_count > 0 then raise exception 'This Billing Address is already used in Purchase Orders and cannot be deleted.' using errcode = 'P0001'; end if;
    for v_delivery_id in select id from public.site_delivery_locations where organization_id = p_organization_id and billing_address_id = p_id loop
      select count(*) into v_count from public.procurement_purchase_orders where delivery_snapshot->>'delivery_location_id' = v_delivery_id::text or delivery_snapshot->'master_selection'->>'delivery_location_id' = v_delivery_id::text;
      if v_count > 0 then raise exception 'This Billing Address has a Delivery Location already used in Purchase Orders and cannot be deleted.' using errcode = 'P0001'; end if;
      delete from public.procurement_address_contacts where organization_id = p_organization_id and delivery_location_id = v_delivery_id;
    end loop;
    delete from public.site_delivery_locations where organization_id = p_organization_id and billing_address_id = p_id;
    delete from public.procurement_address_contacts where organization_id = p_organization_id and billing_address_id = p_id;
    delete from public.company_billing_addresses where id = p_id and organization_id = p_organization_id;
    if v_gst_id is not null then
      select organization_id into v_row_org from public.company_gst_registrations where id = v_gst_id for update;
      select count(*) into v_count from public.company_billing_addresses where organization_id = p_organization_id and gst_registration_id = v_gst_id;
      if v_count = 0 and v_row_org = p_organization_id then delete from public.company_gst_registrations where id = v_gst_id and organization_id = p_organization_id; end if;
    end if;
    return jsonb_build_object('ok', true, 'deleted_kind', p_kind, 'deleted_id', p_id, 'deleted_gst_id', v_gst_id);
  end if;
  raise exception 'Unsupported master graph deletion.' using errcode = 'P0001';
end; $$;
revoke all on function public.delete_procurement_master_graph_atomic(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_procurement_master_graph_atomic(uuid, text, uuid, uuid) to service_role;
