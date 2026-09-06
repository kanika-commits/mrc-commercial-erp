create or replace function public.save_purchase_requisition_approval_configuration_atomic(
  p_scope jsonb,
  p_layers jsonb,
  p_actor jsonb,
  p_event_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration public.purchase_requisition_approval_configurations%rowtype;
  v_layer jsonb;
  v_expected integer;
  v_previous_snapshot jsonb := null;
  v_new_snapshot jsonb;
  v_new_version integer;
  v_layer_count integer := jsonb_array_length(coalesce(p_layers, '[]'::jsonb));
  v_exists boolean := false;
  v_index integer := 0;
  v_layer_number integer;
  v_stage_name text;
  v_approver uuid;
begin
  if jsonb_typeof(p_layers) <> 'array' or v_layer_count not in (2, 3) then
    raise exception 'Approval configuration must contain exactly 2 or 3 layers.';
  end if;
  if nullif(trim(p_scope->>'organization_id'), '') is null
     or nullif(trim(p_scope->>'company_id'), '') is null
     or nullif(trim(p_scope->>'site_id'), '') is null then
    raise exception 'Organization, company, and site are required.';
  end if;

  -- Serialize saves for exactly one organization/company/site scope. This is
  -- transaction-scoped and is released automatically at commit or rollback.
  perform pg_advisory_xact_lock(
    hashtextextended(
      (p_scope->>'organization_id') || ':' ||
      (p_scope->>'company_id') || ':' ||
      (p_scope->>'site_id'),
      0
    )
  );

  select * into v_configuration
  from public.purchase_requisition_approval_configurations
  where organization_id = (p_scope->>'organization_id')::uuid
    and company_id = (p_scope->>'company_id')::uuid
    and site_id = (p_scope->>'site_id')::uuid
  for update;

  if found then
    v_exists := true;
    v_new_version := v_configuration.workflow_version + 1;
    v_previous_snapshot := jsonb_build_object('layer_count', v_configuration.layer_count, 'workflow_version', v_configuration.workflow_version,
      'layers', coalesce((select jsonb_agg(jsonb_build_object('layer_number', layer_number, 'stage_name', stage_name, 'approver_user_id', approver_user_id) order by layer_number)
        from public.purchase_requisition_approval_layers where configuration_id = v_configuration.id and workflow_version = v_configuration.workflow_version), '[]'::jsonb));
  else
    v_new_version := 1;
  end if;

  for v_layer in select value from jsonb_array_elements(p_layers) loop
    v_index := v_index + 1;
    v_layer_number := (v_layer->>'layer_number')::integer;
    v_stage_name := nullif(trim(v_layer->>'stage_name'), '');
    v_approver := nullif(trim(v_layer->>'approver_user_id'), '')::uuid;
    v_expected := v_index;
    if v_layer_number is null or v_layer_number <> v_expected then
      raise exception 'Approval layer numbers must be consecutive from 1 to %.', v_layer_count;
    end if;
    if v_stage_name is null or v_approver is null then raise exception 'Every approval layer requires a stage and approver.'; end if;
  end loop;
  if (select count(distinct (value->>'layer_number')) from jsonb_array_elements(p_layers)) <> v_layer_count then
    raise exception 'Approval layer numbers must be unique.';
  end if;

  if v_exists then
    update public.purchase_requisition_approval_configurations
    set layer_count=v_layer_count, workflow_version=v_new_version, status='active', updated_by=(p_actor->>'user_id')::uuid,
      updated_by_name=p_actor->>'name', updated_by_email=p_actor->>'email', updated_at=now()
    where id=v_configuration.id;
  else
    insert into public.purchase_requisition_approval_configurations(organization_id,company_id,site_id,layer_count,workflow_version,status,created_by,created_by_name,created_by_email,updated_by,updated_by_name,updated_by_email)
    values((p_scope->>'organization_id')::uuid,(p_scope->>'company_id')::uuid,(p_scope->>'site_id')::uuid,v_layer_count,1,'active',(p_actor->>'user_id')::uuid,p_actor->>'name',p_actor->>'email',(p_actor->>'user_id')::uuid,p_actor->>'name',p_actor->>'email') returning * into v_configuration;
  end if;

  insert into public.purchase_requisition_approval_layers(configuration_id,organization_id,company_id,site_id,workflow_version,layer_number,stage_name,approver_user_id,status,created_by,created_by_name,created_by_email,updated_by,updated_by_name,updated_by_email)
  select v_configuration.id,(p_scope->>'organization_id')::uuid,(p_scope->>'company_id')::uuid,(p_scope->>'site_id')::uuid,v_new_version,(value->>'layer_number')::integer,trim(value->>'stage_name'),(value->>'approver_user_id')::uuid,'active',(p_actor->>'user_id')::uuid,p_actor->>'name',p_actor->>'email',(p_actor->>'user_id')::uuid,p_actor->>'name',p_actor->>'email'
  from jsonb_array_elements(p_layers);
  v_new_snapshot := jsonb_build_object('layer_count',v_layer_count,'workflow_version',v_new_version,'layers',p_layers);
  insert into public.purchase_requisition_approval_configuration_events(configuration_id,organization_id,company_id,site_id,previous_workflow_version,new_workflow_version,previous_snapshot,new_snapshot,event_note,created_by,created_by_name,created_by_email)
  values(v_configuration.id,(p_scope->>'organization_id')::uuid,(p_scope->>'company_id')::uuid,(p_scope->>'site_id')::uuid,case when v_new_version=1 then null else v_new_version-1 end,v_new_version,v_previous_snapshot,v_new_snapshot,p_event_note,(p_actor->>'user_id')::uuid,p_actor->>'name',p_actor->>'email');
  return jsonb_build_object('configuration_id',v_configuration.id,'workflow_version',v_new_version);
end;
$$;

revoke all on function public.save_purchase_requisition_approval_configuration_atomic(jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_purchase_requisition_approval_configuration_atomic(jsonb,jsonb,jsonb,text) to service_role;
