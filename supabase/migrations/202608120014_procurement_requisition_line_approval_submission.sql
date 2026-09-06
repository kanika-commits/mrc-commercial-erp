-- Dual-write submission foundation for independent requisition line approval.
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
  current_item record;
  next_submission_cycle integer;
  active_line_count integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;

  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;

  if requisition_row.status not in ('draft', 'sent_back') then
    raise exception 'Only Draft or Sent Back requisitions can be submitted.';
  end if;

  select * into configuration_row
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
       and (layer_number < 1 or layer_number > configuration_row.layer_count
            or nullif(trim(stage_name), '') is null or approver_user_id is null)
  )
  or exists (
    select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
     where not exists (
       select 1 from public.purchase_requisition_approval_layers layer
        where layer.configuration_id = configuration_row.id
          and layer.workflow_version = configuration_row.workflow_version
          and layer.status = 'active'
          and layer.layer_number = expected.layer_number
     )
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (
         select count(*) from public.purchase_requisition_approval_layers duplicate_layer
          where duplicate_layer.configuration_id = configuration_row.id
            and duplicate_layer.workflow_version = configuration_row.workflow_version
            and duplicate_layer.status = 'active'
            and duplicate_layer.layer_number = layer.layer_number
       ) <> 1
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers layer
      left join public.profiles profile on profile.id = layer.approver_user_id
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (profile.id is null or profile.status <> 'active')
  ) then
    raise exception 'Indent approval workflow is not configured for this site.';
  end if;

  select count(*) into active_line_count
    from public.purchase_requisition_items
   where requisition_id = requisition_row.id;
  if active_line_count = 0 then
    raise exception 'At least one material line is required.';
  end if;

  if exists (
    select 1 from public.purchase_requisition_items
     where requisition_id = requisition_row.id and line_key is null
  ) or exists (
    select 1
      from public.purchase_requisition_items
     where requisition_id = requisition_row.id
     group by line_key
    having count(*) > 1
  ) then
    raise exception 'Requisition material line identity is invalid.';
  end if;

  select coalesce(max(existing_step.submission_cycle), 0) + 1 into next_submission_cycle
    from public.purchase_requisition_approval_steps existing_step
   where existing_step.requisition_id = requisition_row.id;

  update public.purchase_requisition_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle < next_submission_cycle
     and status = 'pending';

  update public.purchase_requisition_line_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle < next_submission_cycle
     and status = 'pending';

  for configured_layer in
    select layer.* from public.purchase_requisition_approval_layers layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
     order by layer.layer_number
  loop
    insert into public.purchase_requisition_approval_steps (
      requisition_id, workflow_version, submission_cycle, layer_number, stage_name,
      approver_user_id, approver_name_snapshot, approver_email_snapshot, status
    )
    select requisition_row.id, configuration_row.workflow_version, next_submission_cycle,
           configured_layer.layer_number, configured_layer.stage_name,
           configured_layer.approver_user_id, profile.full_name, profile.email, 'pending'
      from public.profiles profile
     where profile.id = configured_layer.approver_user_id
       and profile.status = 'active';
    if not found then
      raise exception 'Indent approval workflow is not configured for this site.';
    end if;
  end loop;

  if (
    select count(*) from public.purchase_requisition_approval_steps
     where requisition_id = requisition_row.id and submission_cycle = next_submission_cycle
  ) <> configuration_row.layer_count
  or exists (
    select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
     where not exists (
       select 1 from public.purchase_requisition_approval_steps step
        where step.requisition_id = requisition_row.id
          and step.submission_cycle = next_submission_cycle
          and step.layer_number = expected.layer_number
          and step.status = 'pending'
     )
  ) then
    raise exception 'Indent approval workflow snapshot could not be created.';
  end if;

  -- Removed logical lines retain history but no longer have current state.
  update public.purchase_requisition_line_approval_state state
     set approval_status = 'superseded', current_approval_layer = null,
         updated_at = now()
   where state.requisition_id = requisition_row.id
     and not exists (
       select 1 from public.purchase_requisition_items item
        where item.requisition_id = requisition_row.id
          and item.line_key = state.requisition_item_line_key
     );

  for current_item in
    select item.* from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
     order by item.line_key
  loop
    insert into public.purchase_requisition_line_approval_state (
      requisition_id, requisition_item_line_key, workflow_version, submission_cycle,
      current_approval_layer, approval_status, final_approved_at,
      final_approved_by, final_approved_by_name, updated_at
    ) values (
      requisition_row.id, current_item.line_key, configuration_row.workflow_version,
      next_submission_cycle, 1, 'pending', null, null, null, now()
    )
    on conflict (requisition_id, requisition_item_line_key)
    do update set workflow_version = excluded.workflow_version,
                  submission_cycle = excluded.submission_cycle,
                  current_approval_layer = excluded.current_approval_layer,
                  approval_status = excluded.approval_status,
                  final_approved_at = null,
                  final_approved_by = null,
                  final_approved_by_name = null,
                  updated_at = now();

    for configured_layer in
      select layer.* from public.purchase_requisition_approval_layers layer
       where layer.configuration_id = configuration_row.id
         and layer.workflow_version = configuration_row.workflow_version
         and layer.status = 'active'
       order by layer.layer_number
    loop
      insert into public.purchase_requisition_line_approval_steps (
        requisition_id, requisition_item_line_key, workflow_version, submission_cycle,
        layer_number, stage_name, approver_user_id, approver_name_snapshot,
        approver_email_snapshot, status
      )
      select requisition_row.id, current_item.line_key, configuration_row.workflow_version,
             next_submission_cycle, configured_layer.layer_number, configured_layer.stage_name,
             configured_layer.approver_user_id, profile.full_name, profile.email, 'pending'
        from public.profiles profile
       where profile.id = configured_layer.approver_user_id
         and profile.status = 'active';
      if not found then
        raise exception 'Indent line approval workflow snapshot could not be created.';
      end if;
    end loop;
  end loop;

  if (
    select count(*) from public.purchase_requisition_line_approval_state
     where requisition_id = requisition_row.id
       and submission_cycle = next_submission_cycle
       and approval_status = 'pending'
       and current_approval_layer = 1
  ) <> active_line_count
  or (
    select count(*) from public.purchase_requisition_line_approval_steps
     where requisition_id = requisition_row.id
       and submission_cycle = next_submission_cycle
  ) <> active_line_count * configuration_row.layer_count
  or exists (
    select 1 from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and exists (
         select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
          where not exists (
            select 1 from public.purchase_requisition_line_approval_steps step
             where step.requisition_id = requisition_row.id
               and step.requisition_item_line_key = item.line_key
               and step.submission_cycle = next_submission_cycle
               and step.layer_number = expected.layer_number
               and step.status = 'pending'
          )
       )
  ) then
    raise exception 'Indent line approval workflow snapshot could not be created.';
  end if;

  update public.purchase_requisitions
     set status = 'pending_approval', approval_status = 'pending',
         current_approval_layer = 1,
         approval_workflow_version = configuration_row.workflow_version,
         submitted_at = now(), submitted_by = actor_id,
         submitted_by_name = actor_name, submitted_by_email = actor_email,
         sent_back_reason = null, updated_by = actor_id,
         updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id,
    case when requisition_row.status = 'sent_back' then 'resubmitted' else 'submitted' end,
    'Submitted for approval.', requisition_row.status, 'pending_approval',
    actor_id, actor_name, actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'submission_cycle', next_submission_cycle,
    'workflow_version', configuration_row.workflow_version
  );
end;
$$;

revoke all on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
  to service_role;
