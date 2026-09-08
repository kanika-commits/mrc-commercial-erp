begin;

create or replace function public.delete_procurement_item_master_atomic(
  p_organization_id uuid, p_kind text, p_id uuid, p_actor_id uuid, p_actor_name text, p_actor_email text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_record record;
  v_entity_type text;
  v_name text;
  v_code text;
  v_count bigint;
begin
  if p_organization_id is null or p_id is null or p_actor_id is null then raise exception using message = 'INVALID_REQUEST'; end if;
  if p_kind = 'type' then
    select * into v_record from public.procurement_item_types where id = p_id and organization_id = p_organization_id and status <> 'deleted' for update;
    if not found then raise exception using message = 'NOT_FOUND'; end if;
    v_entity_type := 'procurement_item_type'; v_name := v_record.type_name; v_code := v_record.type_code;
    select count(*) into v_count from public.procurement_item_groups where organization_id = p_organization_id and item_type_id = p_id and status <> 'deleted';
    if v_count > 0 then raise exception using message = 'TYPE_HAS_GROUPS'; end if;
    select count(*) into v_count from public.procurement_items where organization_id = p_organization_id and item_type_id = p_id and status <> 'deleted';
    if v_count > 0 then raise exception using message = 'TYPE_IN_USE'; end if;
    delete from public.procurement_item_types where id = p_id and organization_id = p_organization_id;
  elsif p_kind = 'group' then
    select * into v_record from public.procurement_item_groups where id = p_id and organization_id = p_organization_id and status <> 'deleted' for update;
    if not found then raise exception using message = 'NOT_FOUND'; end if;
    v_entity_type := 'procurement_item_group'; v_name := v_record.group_name; v_code := v_record.group_code;
    select count(*) into v_count from public.procurement_items where organization_id = p_organization_id and item_group_id = p_id and status <> 'deleted';
    if v_count > 0 then raise exception using message = 'GROUP_IN_USE'; end if;
    delete from public.procurement_item_groups where id = p_id and organization_id = p_organization_id;
  elsif p_kind = 'uom' then
    select * into v_record from public.procurement_uoms where id = p_id and organization_id = p_organization_id and status <> 'deleted' for update;
    if not found then raise exception using message = 'NOT_FOUND'; end if;
    v_entity_type := 'procurement_uom'; v_name := v_record.uom_name; v_code := v_record.uom_code;
    select count(*) into v_count from public.procurement_items where organization_id = p_organization_id and default_uom_id = p_id and status <> 'deleted';
    if v_count > 0 then raise exception using message = 'UOM_IN_USE'; end if;
    delete from public.procurement_uoms where id = p_id and organization_id = p_organization_id;
  else
    raise exception using message = 'INVALID_KIND';
  end if;
  insert into public.erp_audit_logs (organization_id, module_code, entity_type, record_id, action, description, old_values, created_by, created_by_name, created_by_email, source)
  values (p_organization_id, 'procurement_items', v_entity_type, p_id, 'delete', 'Deleted item master ' || v_name || '.', jsonb_build_object('id', p_id, 'name', v_name, 'code', v_code, 'kind', p_kind), p_actor_id, p_actor_name, p_actor_email, 'api');
  return jsonb_build_object('deleted', true, 'kind', p_kind, 'id', p_id);
end;
$$;

revoke all on function public.delete_procurement_item_master_atomic(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.delete_procurement_item_master_atomic(uuid, text, uuid, uuid, text, text) to service_role;
commit;
