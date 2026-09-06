-- Selected-line approval foundation. Parent approval actions remain unchanged.
-- This migration is intentionally unapplied until explicitly approved.

create or replace function public.approve_purchase_requisition_lines_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_line_keys jsonb,
  p_actor jsonb,
  p_action_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  current_state public.purchase_requisition_line_approval_state%rowtype;
  current_step public.purchase_requisition_line_approval_steps%rowtype;
  next_step public.purchase_requisition_line_approval_steps%rowtype;
  selected_line_keys uuid[];
  selected_line_key uuid;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
  requested_count integer;
  distinct_count integer;
  approved_count integer := 0;
  final_count integer := 0;
  pending_layer integer;
  is_final boolean;
  event_type text;
  event_to_status text;
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;
  if jsonb_typeof(p_line_keys) <> 'array' or jsonb_array_length(p_line_keys) = 0 then
    raise exception 'At least one material line is required.';
  end if;

  begin
    select count(*), count(distinct value::uuid), array_agg(value::uuid order by value::uuid)
      into requested_count, distinct_count, selected_line_keys
      from jsonb_array_elements_text(p_line_keys) as input(value);
  exception when invalid_text_representation then
    raise exception 'Selected material line identity is invalid.';
  end;
  if requested_count <> distinct_count then
    raise exception 'Duplicate material lines are not allowed.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id;
  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;
  if requisition_row.organization_id <> p_organization_id then
    raise exception 'Requisition is outside the requested organization.';
  end if;
  if requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Only Pending Approval requisitions can be approved.';
  end if;

  -- Validate and lock every selected line in stable UUID order before changing any row.
  foreach selected_line_key in array selected_line_keys loop
    if not exists (
      select 1
        from public.purchase_requisition_items item
       where item.requisition_id = requisition_row.id
         and item.line_key = selected_line_key
    ) then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    select * into current_state
      from public.purchase_requisition_line_approval_state
     where requisition_id = requisition_row.id
       and requisition_item_line_key = selected_line_key
     for update;
    if not found then
      raise exception 'Line-level approval workflow is not initialized for this Indent.';
    end if;
    if current_state.approval_status <> 'pending'
       or current_state.submission_cycle is null
       or current_state.current_approval_layer is null then
      raise exception 'One or more selected material lines are no longer pending.';
    end if;

    select * into current_step
      from public.purchase_requisition_line_approval_steps
     where requisition_id = requisition_row.id
       and requisition_item_line_key = current_state.requisition_item_line_key
       and workflow_version = current_state.workflow_version
       and submission_cycle = current_state.submission_cycle
       and layer_number = current_state.current_approval_layer
     for update;
    if not found or current_step.status <> 'pending' then
      raise exception 'One or more selected material lines has no pending current approval step.';
    end if;
    if current_step.approver_user_id <> actor_id then
      raise exception 'You are not the assigned approver for one or more selected material lines.';
    end if;
  end loop;

  foreach selected_line_key in array selected_line_keys loop
    select * into current_state
      from public.purchase_requisition_line_approval_state
     where requisition_id = requisition_row.id
       and requisition_item_line_key = selected_line_key;
    select * into current_step
      from public.purchase_requisition_line_approval_steps
     where requisition_id = requisition_row.id
       and requisition_item_line_key = selected_line_key
       and workflow_version = current_state.workflow_version
       and submission_cycle = current_state.submission_cycle
       and layer_number = current_state.current_approval_layer;

    update public.purchase_requisition_line_approval_steps
       set status = 'approved', acted_by = actor_id,
           acted_by_name = actor_name, acted_by_email = actor_email,
           action_note = nullif(trim(p_action_note), ''), acted_at = now(), updated_at = now()
     where id = current_step.id;

    select * into next_step
      from public.purchase_requisition_line_approval_steps
     where requisition_id = current_state.requisition_id
       and requisition_item_line_key = current_state.requisition_item_line_key
       and workflow_version = current_state.workflow_version
       and submission_cycle = current_state.submission_cycle
       and layer_number = current_state.current_approval_layer + 1
     for update;

    if found then
      if next_step.status <> 'pending' then
        raise exception 'Next line approval step is invalid.';
      end if;
      update public.purchase_requisition_line_approval_state
         set current_approval_layer = next_step.layer_number,
             approval_status = 'pending', updated_at = now()
       where id = current_state.id;
    else
      update public.purchase_requisition_line_approval_state
         set current_approval_layer = null, approval_status = 'approved',
             final_approved_at = now(), final_approved_by = actor_id,
             final_approved_by_name = actor_name, updated_at = now()
       where id = current_state.id;
      final_count := final_count + 1;
    end if;
    approved_count := approved_count + 1;
  end loop;

  -- Serialize only the brief parent compatibility update after line work completes.
  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;
  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;
  if requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Requisition is no longer pending approval.';
  end if;

  select min(current_approval_layer) into pending_layer
    from public.purchase_requisition_line_approval_state state
   where state.requisition_id = requisition_row.id
     and state.approval_status = 'pending';

  if not exists (
    select 1 from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and not exists (
         select 1 from public.purchase_requisition_line_approval_state state
          where state.requisition_id = requisition_row.id
            and state.requisition_item_line_key = item.line_key
            and state.approval_status = 'approved'
       )
  ) then
    update public.purchase_requisitions
       set status = 'approved', approval_status = 'approved', current_approval_layer = null,
           approved_at = now(), approved_by = actor_id, approved_by_name = actor_name,
           approved_by_email = actor_email, updated_by = actor_id,
           updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
     where id = requisition_row.id;
    event_type := 'approved';
    event_to_status := 'approved';
  else
    update public.purchase_requisitions
       set status = 'pending_approval', approval_status = 'pending',
           current_approval_layer = pending_layer, updated_by = actor_id,
           updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
     where id = requisition_row.id;
    event_type := 'line_approved';
    event_to_status := 'pending_approval';
  end if;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id, event_type,
    'Approved ' || approved_count || ' material line' || case when approved_count = 1 then '' else 's' end
      || ' at the current approval layer.'
      || case when nullif(trim(p_action_note), '') is null then '' else ' ' || trim(p_action_note) end,
    requisition_row.status, event_to_status, actor_id, actor_name, actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'approved_line_count', approved_count,
    'final_line_count', final_count,
    'parent_status', event_to_status,
    'current_approval_layer', pending_layer
  );
end;
$$;

revoke all on function public.approve_purchase_requisition_lines_atomic(uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.approve_purchase_requisition_lines_atomic(uuid, uuid, jsonb, jsonb, text)
  to service_role;
