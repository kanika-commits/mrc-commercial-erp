begin;

create or replace function public.approve_purchase_requisition_billing_atomic(
  p_requisition_id uuid,
  p_actor jsonb,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requisitions%rowtype;
  v_step public.purchase_requisition_approval_steps%rowtype;
  v_actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  v_actor_name text := nullif(p_actor->>'name', '');
  v_actor_email text := nullif(p_actor->>'email', '');
  v_latest_cycle integer;
  v_selected_count integer;
  v_selected_distinct integer;
  v_selected_invalid integer;
  v_pending_count integer;
  v_is_global_actor boolean;
begin
  if v_actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  select exists (
    select 1 from public.user_roles user_role
    join public.roles role on role.id = user_role.role_id
    where user_role.user_id = v_actor_id
      and role.role_code in ('platform_owner', 'super_admin')
  ) into v_is_global_actor;
  if p_actor->'line_keys' is null or jsonb_typeof(p_actor->'line_keys') <> 'array' then
    raise exception 'Select at least one material line.';
  end if;
  select * into v_req from public.purchase_requisitions where id = p_requisition_id for update;
  if not found then raise exception 'Purchase Requisition was not found.'; end if;
  if v_req.procurement_flow <> 'billing_engineer' then raise exception 'This requisition uses the historical layered approval workflow.'; end if;
  if v_req.status <> 'pending_approval' or v_req.approval_status <> 'pending' then raise exception 'Only Pending Approval requisitions can be approved.'; end if;
  if coalesce(v_req.current_approval_layer, 0) <> 1 then raise exception 'Only the Requisition Approval stage can use this transition.'; end if;

  select count(*), count(distinct case when value ~* '^[0-9a-f-]{36}$' then value::uuid end), count(*) filter (where value !~* '^[0-9a-f-]{36}$')
    into v_selected_count, v_selected_distinct, v_selected_invalid
    from jsonb_array_elements_text(p_actor->'line_keys') selected(value);
  if v_selected_count = 0 or v_selected_invalid > 0 or v_selected_count <> v_selected_distinct then
    raise exception 'Selected material lines are invalid.';
  end if;
  select count(*) into v_selected_distinct
    from public.purchase_requisition_items item
   where item.requisition_id = v_req.id
     and item.line_key in (select value::uuid from jsonb_array_elements_text(p_actor->'line_keys') selected(value));
  if v_selected_distinct <> v_selected_count then raise exception 'One or more selected material lines were not found.'; end if;

  select max(s.submission_cycle) into v_latest_cycle
    from public.purchase_requisition_approval_steps s
   where s.requisition_id = v_req.id and s.workflow_version = v_req.approval_workflow_version;
  select * into v_step from public.purchase_requisition_approval_steps
   where requisition_id = v_req.id and workflow_version = v_req.approval_workflow_version
     and submission_cycle = v_latest_cycle and layer_number = 1 and status = 'pending'
   for update;
  if not found or (v_step.approver_user_id <> v_actor_id and not v_is_global_actor) then raise exception 'You are not the assigned Requisition Approver.'; end if;

  update public.purchase_requisition_line_approval_steps
     set status = 'approved', acted_at = now(), acted_by = v_actor_id,
         acted_by_name = v_actor_name, acted_by_email = v_actor_email,
         action_note = nullif(trim(p_reason), ''), updated_at = now()
   where requisition_id = v_req.id and submission_cycle = v_latest_cycle
     and layer_number = 1 and status = 'pending'
     and requisition_item_line_key in (select value::uuid from jsonb_array_elements_text(p_actor->'line_keys') selected(value));

  update public.purchase_requisition_line_approval_state state
     set current_approval_layer = null, approval_status = 'approved',
         final_approved_at = now(), final_approved_by = v_actor_id,
         final_approved_by_name = v_actor_name, updated_at = now()
   where state.requisition_id = v_req.id and state.submission_cycle = v_latest_cycle
     and state.approval_status = 'pending'
     and state.requisition_item_line_key in (select value::uuid from jsonb_array_elements_text(p_actor->'line_keys') selected(value));

  select count(*) into v_pending_count
    from public.purchase_requisition_items item
    join public.purchase_requisition_line_approval_state state
      on state.requisition_id = item.requisition_id and state.requisition_item_line_key = item.line_key
   where item.requisition_id = v_req.id and state.submission_cycle = v_latest_cycle and state.approval_status = 'pending';

  if v_pending_count = 0 then
    update public.purchase_requisition_approval_steps
       set status = 'approved', acted_at = now(), acted_by = v_actor_id,
           acted_by_name = v_actor_name, acted_by_email = v_actor_email,
           action_note = nullif(trim(p_reason), ''), updated_at = now()
     where id = v_step.id;
    update public.purchase_requisitions
       set status = 'approved', approval_status = 'approved', current_approval_layer = null,
           approved_at = now(), approved_by = v_actor_id, approved_by_name = v_actor_name,
           approved_by_email = v_actor_email, purchase_pending_at = now(), updated_at = now(),
           updated_by = v_actor_id, updated_by_name = v_actor_name, updated_by_email = v_actor_email
     where id = v_req.id;
    insert into public.purchase_requisition_events
      (requisition_id, event_type, event_note, from_status, to_status, created_by, created_by_name, created_by_email)
    values (v_req.id, 'approved_by_requisition_approver', coalesce(nullif(trim(p_reason), ''), 'All material lines approved.'), v_req.status, 'approved', v_actor_id, v_actor_name, v_actor_email);
    return jsonb_build_object('requisition_id', v_req.id, 'status', 'approved', 'approval_status', 'approved', 'purchase_pending_at', now(), 'pending_line_count', 0);
  end if;

  insert into public.purchase_requisition_events
    (requisition_id, event_type, event_note, from_status, to_status, created_by, created_by_name, created_by_email)
  values (v_req.id, 'approved_requisition_lines', coalesce(nullif(trim(p_reason), ''), 'Selected material lines approved.'), v_req.status, v_req.status, v_actor_id, v_actor_name, v_actor_email);
  return jsonb_build_object('requisition_id', v_req.id, 'status', v_req.status, 'approval_status', v_req.approval_status, 'pending_line_count', v_pending_count);
end;
$$;

revoke all on function public.approve_purchase_requisition_billing_atomic(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.approve_purchase_requisition_billing_atomic(uuid, jsonb, text) to service_role;

commit;
