begin;

create or replace function public.delete_work_order_item_master_atomic(
  p_organization_id uuid,
  p_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.work_order_item_masters%rowtype;
  v_reference_count bigint;
  v_result text;
begin
  if p_organization_id is null or p_id is null or p_actor_id is null then
    raise exception using message = 'INVALID_REQUEST';
  end if;

  select * into v_item
  from public.work_order_item_masters
  where id = p_id
    and organization_id = p_organization_id
    and status <> 'deleted'
  for update;

  if not found then raise exception using message = 'NOT_FOUND'; end if;

  select count(*) into v_reference_count
  from public.work_order_items
  where organization_id = p_organization_id
    and item_master_id = p_id;

  if v_reference_count = 0 then
    delete from public.work_order_item_masters
    where id = p_id and organization_id = p_organization_id;
    v_result := 'deleted';
  else
    update public.work_order_item_masters
    set status = 'inactive', updated_by = p_actor_id, updated_by_name = p_actor_name,
        updated_by_email = p_actor_email, updated_at = now()
    where id = p_id and organization_id = p_organization_id;
    v_result := 'deactivated';
  end if;

  if to_regclass('public.erp_audit_logs') is not null then
    insert into public.erp_audit_logs (
      organization_id, module_code, entity_type, record_id, action, description,
      old_values, new_values, created_by, created_by_name, created_by_email, source
    ) values (
      p_organization_id, 'work_orders', 'work_order_item_master', p_id, 'delete',
      case when v_result = 'deleted' then 'Deleted Work Order Item Master ' || v_item.item_header
           else 'Deactivated referenced Work Order Item Master ' || v_item.item_header end,
      jsonb_build_object('id', v_item.id, 'item_header', v_item.item_header,
        'description', v_item.description, 'unit', v_item.unit,
        'mode_of_measurement', v_item.mode_of_measurement, 'status', v_item.status),
      jsonb_build_object('result', v_result, 'reference_count', v_reference_count),
      p_actor_id, p_actor_name, p_actor_email, 'api'
    );
  end if;

  return jsonb_build_object('result', v_result, 'id', p_id,
    'reference_count', v_reference_count);
end;
$$;

revoke all on function public.delete_work_order_item_master_atomic(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_work_order_item_master_atomic(uuid, uuid, uuid, text, text)
  to service_role;

commit;
