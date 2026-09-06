-- Selected-line approval editing foundation.
-- This migration is intentionally unapplied until explicitly approved.

create or replace function public.edit_purchase_requisition_lines_during_approval_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_lines jsonb,
  p_actor jsonb,
  p_event_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  line_state public.purchase_requisition_line_approval_state%rowtype;
  line_step public.purchase_requisition_line_approval_steps%rowtype;
  item_row public.purchase_requisition_items%rowtype;
  item_master public.procurement_items%rowtype;
  uom_row public.procurement_uoms%rowtype;
  item_json jsonb;
  make_json jsonb;
  selected_line_keys uuid[];
  selected_line_key uuid;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
  requested_count integer;
  distinct_count integer;
  line_index integer := 0;
  requested_uom_id uuid;
  requested_item_id uuid;
  requested_employee_id uuid;
  quantity_value numeric;
  requested_by_name text;
  required_by_value date;
  minimum_required_by date;
  updated_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if p_requisition_id is null or p_organization_id is null then
    raise exception 'Requisition scope is required.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one material line is required.';
  end if;

  begin
    select count(*), count(distinct (value ->> 'line_key')::uuid),
           array_agg((value ->> 'line_key')::uuid order by (value ->> 'line_key')::uuid)
      into requested_count, distinct_count, selected_line_keys
      from jsonb_array_elements(p_lines);
  exception when invalid_text_representation then
    raise exception 'Selected material line identity is invalid.';
  end;
  if requested_count <> distinct_count then
    raise exception 'Duplicate material lines are not allowed.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
     and organization_id = p_organization_id;
  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;
  if requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Only Pending Approval requisitions can be edited by the current approver.';
  end if;

  -- Validate and lock all selected logical lines in deterministic line-key order.
  foreach selected_line_key in array selected_line_keys loop
    if not exists (
      select 1 from public.purchase_requisition_items item
       where item.requisition_id = requisition_row.id
         and item.line_key = selected_line_key
    ) then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    select * into line_state
      from public.purchase_requisition_line_approval_state state
     where state.requisition_id = requisition_row.id
       and state.requisition_item_line_key = selected_line_key
     for update;
    if not found or line_state.approval_status <> 'pending'
       or line_state.current_approval_layer is null then
      raise exception 'One or more selected material lines is no longer pending.';
    end if;

    select * into line_step
      from public.purchase_requisition_line_approval_steps step
     where step.requisition_id = requisition_row.id
       and step.requisition_item_line_key = selected_line_key
       and step.workflow_version = line_state.workflow_version
       and step.submission_cycle = line_state.submission_cycle
       and step.layer_number = line_state.current_approval_layer
     for update;
    if not found or line_step.status <> 'pending' then
      raise exception 'One or more selected material lines has no pending current approval step.';
    end if;
    if line_step.approver_user_id <> actor_id then
      raise exception 'You are not the assigned approver for one or more selected material lines.';
    end if;

    select * into item_row
      from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and item.line_key = selected_line_key
     for update;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;
  end loop;

  -- Validate every submitted value before changing any selected line.
  for item_json in select value from jsonb_array_elements(p_lines) loop
    line_index := line_index + 1;
    requested_item_id := nullif(item_json ->> 'item_id', '')::uuid;
    requested_uom_id := nullif(item_json ->> 'uom_id', '')::uuid;
    requested_employee_id := nullif(item_json ->> 'requested_by_employee_id', '')::uuid;
    quantity_value := (item_json ->> 'quantity')::numeric;

    if nullif(trim(item_json ->> 'required_by_date'), '') is null then
      raise exception 'Required by date is required for every material line.';
    end if;
    begin
      required_by_value := (item_json ->> 'required_by_date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'Required by date is invalid on line %.', line_index;
    end;
    if item_json ? 'approved_makes'
       and item_json -> 'approved_makes' <> 'null'::jsonb
       and jsonb_typeof(item_json -> 'approved_makes') <> 'array' then
      raise exception 'Approved makes must be an array on line %.', line_index;
    end if;
    if requested_item_id is null or requested_employee_id is null then
      raise exception 'Item and Requested By are required on line %.', line_index;
    end if;
    select * into item_master
      from public.procurement_items item
     where item.id = requested_item_id
       and item.organization_id = requisition_row.organization_id
       and item.status = 'active';
    if not found then
      raise exception 'Active item was not found on line %.', line_index;
    end if;
    if item_master.default_uom_id is null
       or (requested_uom_id is not null and requested_uom_id <> item_master.default_uom_id) then
      raise exception 'Selected UOM does not match the Item Master on line %.', line_index;
    end if;
    select * into uom_row
      from public.procurement_uoms uom
     where uom.id = item_master.default_uom_id
       and uom.organization_id = requisition_row.organization_id
       and uom.status = 'active';
    if not found then
      raise exception 'Active UOM was not found on line %.', line_index;
    end if;
    if quantity_value is null or quantity_value <= 0 then
      raise exception 'Quantity must be greater than 0 on line %.', line_index;
    end if;
    select employee.employee_name into requested_by_name
      from public.hr_employees employee
     where employee.id = requested_employee_id
       and employee.organization_id = requisition_row.organization_id
       and employee.status = 'active'
       and (
         employee.site_id = requisition_row.site_id
         or exists (
           select 1 from public.sites head_office
            where head_office.id = employee.site_id
              and head_office.organization_id = employee.organization_id
              and head_office.status = 'active'
              and head_office.site_code = 'HO'
         )
       );
    if not found then
      raise exception 'Requested-by employee is invalid on line %.', line_index;
    end if;
  end loop;

  -- Update selected physical rows in place, preserving line_key and attachment ownership.
  line_index := 0;
  for item_json in select value from jsonb_array_elements(p_lines) loop
    line_index := line_index + 1;
    selected_line_key := (item_json ->> 'line_key')::uuid;
    requested_item_id := nullif(item_json ->> 'item_id', '')::uuid;
    requested_uom_id := nullif(item_json ->> 'uom_id', '')::uuid;
    requested_employee_id := nullif(item_json ->> 'requested_by_employee_id', '')::uuid;
    quantity_value := (item_json ->> 'quantity')::numeric;
    required_by_value := (item_json ->> 'required_by_date')::date;

    select * into item_master
      from public.procurement_items item
     where item.id = requested_item_id
       and item.organization_id = requisition_row.organization_id
       and item.status = 'active';
    select * into uom_row
      from public.procurement_uoms uom
     where uom.id = item_master.default_uom_id
       and uom.organization_id = requisition_row.organization_id
       and uom.status = 'active';
    select employee.employee_name into requested_by_name
      from public.hr_employees employee
     where employee.id = requested_employee_id
       and employee.organization_id = requisition_row.organization_id
       and employee.status = 'active'
       and (employee.site_id = requisition_row.site_id or exists (
         select 1 from public.sites head_office
          where head_office.id = employee.site_id
            and head_office.organization_id = employee.organization_id
            and head_office.status = 'active'
            and head_office.site_code = 'HO'
       ));

    select * into item_row
      from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and item.line_key = selected_line_key
     for update;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    update public.purchase_requisition_items
       set item_id = item_master.id,
           item_name_snapshot = item_master.item_name,
           item_code_snapshot = item_master.item_code,
           specification = nullif(item_json ->> 'specification', ''),
           make_brand = nullif(item_json ->> 'make_brand', ''),
           uom_id = uom_row.id,
           uom_snapshot = uom_row.uom_code,
           quantity = quantity_value,
           required_by_date = required_by_value,
           requested_by_employee_id = requested_employee_id,
           requested_by_name_snapshot = requested_by_name,
           remarks = nullif(item_json ->> 'remarks', ''),
           updated_at = now()
     where requisition_id = requisition_row.id
       and line_key = selected_line_key;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    delete from public.purchase_requisition_item_approved_makes makes
     where makes.requisition_item_id = item_row.id;
    if jsonb_typeof(item_json -> 'approved_makes') = 'array' then
      for make_json in select value from jsonb_array_elements(item_json -> 'approved_makes') loop
        if nullif(trim(make_json #>> '{}'), '') is not null then
          insert into public.purchase_requisition_item_approved_makes (
            requisition_item_id, make_name_snapshot, sort_order
          ) values (
            item_row.id, trim(make_json #>> '{}'),
            (select count(*) + 1 from public.purchase_requisition_item_approved_makes
              where requisition_item_id = item_row.id)
          );
        end if;
      end loop;
    end if;
    updated_count := updated_count + 1;
  end loop;

  -- Recompute the legacy header date from every current line, not only selected lines.
  select min(item.required_by_date) into minimum_required_by
    from public.purchase_requisition_items item
   where item.requisition_id = requisition_row.id;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;
  if not found or requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Requisition is no longer pending approval.';
  end if;
  update public.purchase_requisitions
     set required_by_date = minimum_required_by,
         updated_by = actor_id, updated_by_name = actor_name,
         updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id, 'line_edited_during_approval',
    coalesce(nullif(trim(p_event_note), ''),
      'Edited ' || updated_count || ' material line' || case when updated_count = 1 then '' else 's' end
      || ' during approval.'), requisition_row.status, requisition_row.status,
    actor_id, actor_name, actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'updated_line_count', updated_count,
    'submission_cycle', (select max(state.submission_cycle)
      from public.purchase_requisition_line_approval_state state
     where state.requisition_id = requisition_row.id)
  );
end;
$$;

revoke all on function public.edit_purchase_requisition_lines_during_approval_atomic(uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.edit_purchase_requisition_lines_during_approval_atomic(uuid, uuid, jsonb, jsonb, text)
  to service_role;
