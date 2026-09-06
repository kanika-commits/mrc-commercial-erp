-- Approval-stage Indent corrections. This migration is intentionally unapplied.

create or replace function public.edit_purchase_requisition_during_approval_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_snapshots jsonb,
  p_actor jsonb,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  current_step public.purchase_requisition_approval_steps%rowtype;
  actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor->>'name'), '');
  actor_email text := nullif(trim(p_actor->>'email'), '');
  latest_cycle integer;
  item_json jsonb;
  snapshot_json jsonb;
  item_row public.procurement_items%rowtype;
  uom_row public.procurement_uoms%rowtype;
  new_item_id uuid;
  inserted_item_id uuid;
  requested_uom_id uuid;
  quantity_value numeric;
  item_index integer := 0;
begin
  if actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  if p_requisition_id is null or p_organization_id is null then raise exception 'Requisition scope is required.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one requisition item is required.'; end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id and organization_id = p_organization_id and status <> 'deleted'
   for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if requisition_row.status <> 'pending_approval' then raise exception 'Only Pending Approval requisitions can be edited by the current approver.'; end if;

  select max(submission_cycle) into latest_cycle
    from public.purchase_requisition_approval_steps
   where requisition_id = requisition_row.id and workflow_version = requisition_row.approval_workflow_version;
  if latest_cycle is null or requisition_row.current_approval_layer is null then raise exception 'Current approval workflow is incomplete.'; end if;

  select * into current_step
    from public.purchase_requisition_approval_steps
   where requisition_id = requisition_row.id
     and workflow_version = requisition_row.approval_workflow_version
     and submission_cycle = latest_cycle
     and layer_number = requisition_row.current_approval_layer
   for update;
  if not found or current_step.status <> 'pending' then raise exception 'Current approval step is no longer pending.'; end if;
  if current_step.approver_user_id <> actor_id then raise exception 'Only the assigned current approver can edit this requisition.'; end if;

  update public.purchase_requisitions
     set requisition_date = coalesce(nullif(p_header->>'requisition_date', '')::date, requisition_row.requisition_date),
         required_by_date = nullif(p_header->>'required_by_date', '')::date,
         priority = case when p_header->>'priority' in ('Normal', 'Urgent', 'Critical') then p_header->>'priority' else requisition_row.priority end,
         purpose = nullif(trim(p_header->>'purpose'), ''),
         remarks = nullif(p_header->>'remarks', ''),
         updated_by = actor_id, updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;
  if nullif(trim(p_header->>'purpose'), '') is null or nullif(p_header->>'required_by_date', '') is null then raise exception 'Purpose and required by date are required.'; end if;

  delete from public.purchase_requisition_item_approved_makes where requisition_item_id in (select id from public.purchase_requisition_items where requisition_id = requisition_row.id);
  delete from public.purchase_requisition_items where requisition_id = requisition_row.id;

  for item_json, item_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    new_item_id := nullif(item_json->>'item_id', '')::uuid;
    requested_uom_id := nullif(item_json->>'uom_id', '')::uuid;
    quantity_value := (item_json->>'quantity')::numeric;
    select * into item_row from public.procurement_items where id = new_item_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active item was not found on line %.', item_index; end if;
    if item_row.default_uom_id is null or (requested_uom_id is not null and requested_uom_id <> item_row.default_uom_id) then raise exception 'Selected UOM does not match the Item Master on line %.', item_index; end if;
    select * into uom_row from public.procurement_uoms where id = item_row.default_uom_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active UOM was not found on line %.', item_index; end if;
    if quantity_value is null or quantity_value <= 0 then raise exception 'Quantity must be greater than 0 on line %.', item_index; end if;
    insert into public.purchase_requisition_items (requisition_id, item_id, item_name_snapshot, item_code_snapshot, specification, make_brand, uom_id, uom_snapshot, quantity, required_by_date, remarks, sort_order)
    values (requisition_row.id, item_row.id, item_row.item_name, item_row.item_code, nullif(item_json->>'specification', ''), nullif(item_json->>'make_brand', ''), uom_row.id, uom_row.uom_code, quantity_value, nullif(item_json->>'required_by_date', '')::date, nullif(item_json->>'remarks', ''), item_index)
    returning id into inserted_item_id;
    if jsonb_typeof(p_snapshots) = 'array' and jsonb_typeof(p_snapshots->(item_index - 1)) = 'array' then
      for snapshot_json in select value from jsonb_array_elements(p_snapshots->(item_index - 1)) loop
        if nullif(trim(snapshot_json #>> '{}'), '') is not null then
          insert into public.purchase_requisition_item_approved_makes (requisition_item_id, make_name_snapshot, sort_order)
          values (inserted_item_id, trim(snapshot_json #>> '{}'), (select count(*) from public.purchase_requisition_item_approved_makes where requisition_item_id = inserted_item_id) + 1);
        end if;
      end loop;
    end if;
  end loop;

  insert into public.purchase_requisition_events (requisition_id, event_type, event_note, from_status, to_status, created_by, created_by_name, created_by_email)
  values (requisition_row.id, 'edited_during_approval', coalesce(nullif(trim(p_event->>'event_note'), ''), 'Edited during Layer ' || current_step.layer_number || ' — ' || current_step.stage_name || '.'), requisition_row.status, requisition_row.status, actor_id, actor_name, actor_email);
  return jsonb_build_object('requisition_id', requisition_row.id, 'layer_number', current_step.layer_number, 'submission_cycle', latest_cycle);
end;
$$;

revoke all on function public.edit_purchase_requisition_during_approval_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.edit_purchase_requisition_during_approval_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
