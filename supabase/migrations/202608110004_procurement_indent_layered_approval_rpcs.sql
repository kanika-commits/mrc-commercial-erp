-- Operational layered Indent approval workflow.
-- This migration is intentionally unapplied until explicitly approved.

create or replace function public.submit_purchase_requisition_for_approval_atomic(
  p_requisition_id uuid,
  p_actor jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  configuration_row public.purchase_requisition_approval_configurations%rowtype;
  configured_layer record;
  next_submission_cycle integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;

  select *
    into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;

  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;

  if requisition_row.status not in ('draft', 'sent_back') then
    raise exception 'Only Draft or Sent Back requisitions can be submitted.';
  end if;

  select *
    into configuration_row
    from public.purchase_requisition_approval_configurations
   where organization_id = requisition_row.organization_id
     and company_id = requisition_row.company_id
     and site_id = requisition_row.site_id
     and status = 'active'
   for update;

  if not found or configuration_row.layer_count not in (2, 3) then
    raise exception 'Indent approval workflow is not configured for this site.';
  end if;

  if (
    select count(*)
      from public.purchase_requisition_approval_layers
     where configuration_id = configuration_row.id
       and workflow_version = configuration_row.workflow_version
       and status = 'active'
  ) <> configuration_row.layer_count
  or exists (
    select 1
      from public.purchase_requisition_approval_layers
     where configuration_id = configuration_row.id
       and workflow_version = configuration_row.workflow_version
       and status = 'active'
       and (
         layer_number < 1
         or layer_number > configuration_row.layer_count
         or nullif(trim(stage_name), '') is null
         or approver_user_id is null
       )
  )
  or exists (
    select 1
      from generate_series(1, configuration_row.layer_count) as expected(layer_number)
     where not exists (
       select 1
         from public.purchase_requisition_approval_layers
        where configuration_id = configuration_row.id
          and workflow_version = configuration_row.workflow_version
          and status = 'active'
          and layer_number = expected.layer_number
     )
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers as layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (
         select count(*)
           from public.purchase_requisition_approval_layers as duplicate_layer
          where duplicate_layer.configuration_id = configuration_row.id
            and duplicate_layer.workflow_version = configuration_row.workflow_version
            and duplicate_layer.status = 'active'
            and duplicate_layer.layer_number = layer.layer_number
       ) <> 1
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers as layer
      left join public.profiles as profile on profile.id = layer.approver_user_id
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (
         profile.id is null
         or profile.status <> 'active'
       )
  ) then
    raise exception 'Indent approval workflow is not configured for this site.';
  end if;

  select coalesce(max(existing_step.submission_cycle), 0) + 1
    into next_submission_cycle
    from public.purchase_requisition_approval_steps as existing_step
   where existing_step.requisition_id = requisition_row.id;

  update public.purchase_requisition_approval_steps
     set status = 'superseded',
         updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle < next_submission_cycle
     and status = 'pending';

  for configured_layer in
    select layer.*
      from public.purchase_requisition_approval_layers as layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
     order by layer.layer_number
  loop
    insert into public.purchase_requisition_approval_steps (
      requisition_id,
      workflow_version,
      submission_cycle,
      layer_number,
      stage_name,
      approver_user_id,
      approver_name_snapshot,
      approver_email_snapshot,
      status
    )
    select requisition_row.id,
           configuration_row.workflow_version,
           next_submission_cycle,
           configured_layer.layer_number,
           configured_layer.stage_name,
           configured_layer.approver_user_id,
           profile.full_name,
           profile.email,
           'pending'
      from public.profiles as profile
     where profile.id = configured_layer.approver_user_id
       and profile.status = 'active';

    if not found then
      raise exception 'Indent approval workflow is not configured for this site.';
    end if;
  end loop;

  if (
    select count(*)
      from public.purchase_requisition_approval_steps
     where requisition_id = requisition_row.id
       and submission_cycle = next_submission_cycle
  ) <> configuration_row.layer_count
  or exists (
    select 1
      from generate_series(1, configuration_row.layer_count) as expected(layer_number)
     where not exists (
       select 1
         from public.purchase_requisition_approval_steps as step
        where step.requisition_id = requisition_row.id
          and step.submission_cycle = next_submission_cycle
          and step.layer_number = expected.layer_number
          and step.status = 'pending'
     )
  ) then
    raise exception 'Indent approval workflow snapshot could not be created.';
  end if;

  update public.purchase_requisitions
     set status = 'pending_approval',
         approval_status = 'pending',
         current_approval_layer = 1,
         approval_workflow_version = configuration_row.workflow_version,
         submitted_at = now(),
         submitted_by = actor_id,
         submitted_by_name = actor_name,
         submitted_by_email = actor_email,
         sent_back_reason = null,
         updated_by = actor_id,
         updated_by_name = actor_name,
         updated_by_email = actor_email,
         updated_at = now()
   where id = requisition_row.id;

  insert into public.purchase_requisition_events (
    requisition_id,
    event_type,
    event_note,
    from_status,
    to_status,
    created_by,
    created_by_name,
    created_by_email
  )
  values (
    requisition_row.id,
    case when requisition_row.status = 'sent_back' then 'resubmitted' else 'submitted' end,
    'Submitted for approval.',
    requisition_row.status,
    'pending_approval',
    actor_id,
    actor_name,
    actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'submission_cycle', next_submission_cycle,
    'workflow_version', configuration_row.workflow_version
  );
end;
$$;

create or replace function public.approve_purchase_requisition_layer_atomic(
  p_requisition_id uuid,
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
  current_step public.purchase_requisition_approval_steps%rowtype;
  next_step public.purchase_requisition_approval_steps%rowtype;
  latest_cycle integer;
  next_layer integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
  is_final boolean;
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;

  if not found then
    raise exception 'Requisition was not found.';
  end if;
  if requisition_row.status <> 'pending_approval' then
    raise exception 'Only Pending Approval requisitions can be approved.';
  end if;

  select max(step.submission_cycle) into latest_cycle
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id;

  select * into current_step
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id
     and step.submission_cycle = latest_cycle
     and step.layer_number = requisition_row.current_approval_layer
   for update;

  if not found
     or current_step.status <> 'pending'
     or current_step.layer_number <> requisition_row.current_approval_layer then
    raise exception 'This approval step is no longer pending.';
  end if;
  if current_step.approver_user_id <> actor_id then
    raise exception 'You are not the assigned approver for this layer.';
  end if;

  update public.purchase_requisition_approval_steps
     set status = 'approved',
         acted_at = now(),
         acted_by = actor_id,
         acted_by_name = actor_name,
         acted_by_email = actor_email,
         action_note = nullif(trim(p_action_note), ''),
         updated_at = now()
   where id = current_step.id;

  next_layer := requisition_row.current_approval_layer + 1;
  select * into next_step
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id
     and step.submission_cycle = latest_cycle
     and step.layer_number = next_layer
   for update;

  if found then
    if next_step.layer_number <> next_layer or next_step.status <> 'pending' then
      raise exception 'Next approval layer is invalid.';
    end if;
    is_final := false;
    update public.purchase_requisitions
       set current_approval_layer = next_layer,
           updated_by = actor_id,
           updated_by_name = actor_name,
           updated_by_email = actor_email,
           updated_at = now()
     where id = requisition_row.id;
  else
    if exists (
      select 1
        from public.purchase_requisition_approval_steps as step
       where step.requisition_id = requisition_row.id
         and step.submission_cycle = latest_cycle
         and step.layer_number > requisition_row.current_approval_layer
         and step.status = 'pending'
    ) then
      raise exception 'Approval workflow contains a higher pending layer.';
    end if;
    is_final := true;
    update public.purchase_requisitions
       set status = 'approved',
           approval_status = 'approved',
           current_approval_layer = null,
           approved_at = now(),
           approved_by = actor_id,
           approved_by_name = actor_name,
           approved_by_email = actor_email,
           updated_by = actor_id,
           updated_by_name = actor_name,
           updated_by_email = actor_email,
           updated_at = now()
     where id = requisition_row.id;
  end if;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  )
  values (
    requisition_row.id,
    'approved',
    'Layer ' || current_step.layer_number || ' — ' || current_step.stage_name
      || case when nullif(trim(p_action_note), '') is null then '.' else ': ' || trim(p_action_note) end,
    requisition_row.status,
    case when is_final then 'approved' else 'pending_approval' end,
    actor_id,
    actor_name,
    actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'layer_number', current_step.layer_number,
    'final', is_final
  );
end;
$$;

create or replace function public.send_back_purchase_requisition_layer_atomic(
  p_requisition_id uuid,
  p_actor jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  current_step public.purchase_requisition_approval_steps%rowtype;
  latest_cycle integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Send Back reason is required.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if requisition_row.status <> 'pending_approval' then
    raise exception 'Only Pending Approval requisitions can be sent back.';
  end if;

  select max(step.submission_cycle) into latest_cycle
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id;
  select * into current_step
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id
     and step.submission_cycle = latest_cycle
     and step.layer_number = requisition_row.current_approval_layer
   for update;
  if not found or current_step.status <> 'pending' or current_step.layer_number <> requisition_row.current_approval_layer then
    raise exception 'This approval step is no longer pending.';
  end if;
  if current_step.approver_user_id <> actor_id then
    raise exception 'You are not the assigned approver for this layer.';
  end if;

  update public.purchase_requisition_approval_steps
     set status = 'sent_back', acted_at = now(), acted_by = actor_id,
         acted_by_name = actor_name, acted_by_email = actor_email,
         action_note = trim(p_reason), updated_at = now()
   where id = current_step.id;
  update public.purchase_requisition_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle = latest_cycle
     and id <> current_step.id
     and status = 'pending';
  update public.purchase_requisitions
     set status = 'sent_back', approval_status = 'sent_back', sent_back_at = now(),
         sent_back_by = actor_id, sent_back_by_name = actor_name,
         sent_back_by_email = actor_email, sent_back_reason = trim(p_reason),
         updated_by = actor_id, updated_by_name = actor_name,
         updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;
  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id, 'sent_back',
    'Layer ' || current_step.layer_number || ' — ' || current_step.stage_name || ': ' || trim(p_reason),
    requisition_row.status, 'sent_back', actor_id, actor_name, actor_email
  );
  return jsonb_build_object('requisition_id', requisition_row.id, 'layer_number', current_step.layer_number);
end;
$$;

create or replace function public.reject_purchase_requisition_layer_atomic(
  p_requisition_id uuid,
  p_actor jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  current_step public.purchase_requisition_approval_steps%rowtype;
  latest_cycle integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Reject reason is required.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if requisition_row.status <> 'pending_approval' then
    raise exception 'Only Pending Approval requisitions can be rejected.';
  end if;

  select max(step.submission_cycle) into latest_cycle
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id;
  select * into current_step
    from public.purchase_requisition_approval_steps as step
   where step.requisition_id = requisition_row.id
     and step.submission_cycle = latest_cycle
     and step.layer_number = requisition_row.current_approval_layer
   for update;
  if not found or current_step.status <> 'pending' or current_step.layer_number <> requisition_row.current_approval_layer then
    raise exception 'This approval step is no longer pending.';
  end if;
  if current_step.approver_user_id <> actor_id then
    raise exception 'You are not the assigned approver for this layer.';
  end if;

  update public.purchase_requisition_approval_steps
     set status = 'rejected', acted_at = now(), acted_by = actor_id,
         acted_by_name = actor_name, acted_by_email = actor_email,
         action_note = trim(p_reason), updated_at = now()
   where id = current_step.id;
  update public.purchase_requisition_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle = latest_cycle
     and id <> current_step.id
     and status = 'pending';
  update public.purchase_requisitions
     set status = 'rejected', approval_status = 'rejected', rejected_at = now(),
         rejected_by = actor_id, rejected_by_name = actor_name,
         rejected_by_email = actor_email, rejection_reason = trim(p_reason),
         updated_by = actor_id, updated_by_name = actor_name,
         updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;
  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id, 'rejected',
    'Layer ' || current_step.layer_number || ' — ' || current_step.stage_name || ': ' || trim(p_reason),
    requisition_row.status, 'rejected', actor_id, actor_name, actor_email
  );
  return jsonb_build_object('requisition_id', requisition_row.id, 'layer_number', current_step.layer_number);
end;
$$;

revoke all on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.approve_purchase_requisition_layer_atomic(uuid, jsonb, text)
from public, anon, authenticated;
revoke all on function public.send_back_purchase_requisition_layer_atomic(uuid, jsonb, text)
from public, anon, authenticated;
revoke all on function public.reject_purchase_requisition_layer_atomic(uuid, jsonb, text)
from public, anon, authenticated;

grant execute on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
to service_role;
grant execute on function public.approve_purchase_requisition_layer_atomic(uuid, jsonb, text)
to service_role;
grant execute on function public.send_back_purchase_requisition_layer_atomic(uuid, jsonb, text)
to service_role;
grant execute on function public.reject_purchase_requisition_layer_atomic(uuid, jsonb, text)
to service_role;
