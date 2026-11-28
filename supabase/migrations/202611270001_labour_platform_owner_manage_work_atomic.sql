-- Platform Owner-only correction path for reactivation plus assignment/rate changes.
-- The API remains responsible for permission, organization, company, site, trade,
-- Work Order, and Platform Owner checks. This function makes the related writes
-- one transaction and records explicit corrections instead of duplicating rows.
create or replace function public.manage_labour_work_atomic(
  p_worker_id uuid,
  p_organization_id uuid,
  p_assignment jsonb,
  p_rate_change jsonb,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.labour_workers%rowtype;
  v_same_deployment public.labour_deployments%rowtype;
  v_deployment_id uuid;
  v_wage_rate_id uuid;
  v_existing_rate public.labour_wage_rates%rowtype;
  v_current_rate public.labour_wage_rates%rowtype;
  v_assignment jsonb := coalesce(p_assignment, '{}'::jsonb);
  v_rate jsonb := p_rate_change;
  v_effective_from date := nullif(v_assignment->>'effective_from', '')::date;
  v_rate_effective_from date := nullif(v_rate->>'effective_from', '')::date;
  v_rate_base numeric := nullif(v_rate->>'base_rate', '')::numeric;
  v_old_values jsonb;
begin
  select * into v_worker
    from public.labour_workers
   where id = p_worker_id
     and organization_id = p_organization_id
     and status <> 'deleted'
   for update;
  if not found then raise exception 'Labourer not found.'; end if;
  if v_effective_from is null then raise exception 'Effective date is required.'; end if;

  -- A same-date row is an explicit correction case. Reuse that row, preserve
  -- its identity, and write an audit event with the before/after snapshots.
  select * into v_same_deployment
    from public.labour_deployments
   where labour_worker_id = p_worker_id
     and organization_id = p_organization_id
     and effective_from = v_effective_from
   order by created_at desc
   limit 1
   for update;

  if v_same_deployment.id is not null then
    if exists (
      select 1 from public.labour_deployments d
       where d.labour_worker_id = p_worker_id
         and d.organization_id = p_organization_id
         and d.id <> v_same_deployment.id
         and d.effective_from <= coalesce(nullif(v_assignment->>'effective_to', '')::date, '9999-12-31'::date)
         and coalesce(d.effective_to, '9999-12-31'::date) >= v_effective_from
    ) then
      raise exception 'A different deployment overlaps the correction date; choose a non-overlapping effective date.';
    end if;

    v_old_values := to_jsonb(v_same_deployment);
    update public.labour_deployments
       set contractor_profile_id = nullif(v_assignment->>'contractor_profile_id', '')::uuid,
           company_id = nullif(v_assignment->>'company_id', '')::uuid,
           site_id = nullif(v_assignment->>'site_id', '')::uuid,
           work_order_id = nullif(v_assignment->>'work_order_id', '')::uuid,
           manpower_work_order_id = nullif(v_assignment->>'manpower_work_order_id', '')::uuid,
           commercial_model = nullif(v_assignment->>'commercial_model', ''),
           trade = nullif(v_assignment->>'trade', ''),
           labour_trade_id = nullif(v_assignment->>'labour_trade_id', '')::uuid,
           skill_level = nullif(v_assignment->>'skill_level', ''),
           wage_type = nullif(v_assignment->>'wage_type', ''),
           wage_rate = nullif(v_assignment->>'wage_rate', '')::numeric,
           effective_to = nullif(v_assignment->>'effective_to', '')::date,
           status = case when nullif(v_assignment->>'effective_to', '') is null then 'active' else 'ended' end,
           deployment_reason = nullif(v_assignment->>'deployment_reason', ''),
           updated_at = now(),
           updated_by = p_actor_id,
           updated_by_name = p_actor_name,
           updated_by_email = p_actor_email
     where id = v_same_deployment.id
     returning id into v_deployment_id;

    insert into public.erp_audit_logs (
      organization_id, company_id, site_id, module_code, entity_type,
      record_id, parent_entity_type, parent_record_id, action, description,
      old_values, new_values, source, created_by, created_by_name, created_by_email
    ) values (
      p_organization_id,
      nullif(v_assignment->>'company_id', '')::uuid,
      nullif(v_assignment->>'site_id', '')::uuid,
      'labour_deployments', 'labour_deployment', v_deployment_id,
      'labour_worker', p_worker_id, 'update',
      'Platform Owner corrected/reused a same-date deployment during reactivation.',
      v_old_values, v_assignment, 'api', p_actor_id, p_actor_name, p_actor_email
    );
  else
    if v_worker.status = 'inactive' then
      v_deployment_id := public.reactivate_labour_deployment(
        p_worker_id, p_organization_id,
        nullif(v_assignment->>'contractor_profile_id', '')::uuid,
        nullif(v_assignment->>'company_id', '')::uuid,
        nullif(v_assignment->>'site_id', '')::uuid,
        nullif(v_assignment->>'work_order_id', '')::uuid,
        nullif(v_assignment->>'manpower_work_order_id', '')::uuid,
        v_assignment->>'commercial_model', v_assignment->>'trade',
        nullif(v_assignment->>'labour_trade_id', '')::uuid,
        v_assignment->>'skill_level', v_assignment->>'wage_type',
        nullif(v_assignment->>'wage_rate', '')::numeric,
        v_effective_from, nullif(v_assignment->>'effective_to', '')::date,
        v_assignment->>'deployment_reason', p_actor_id, p_actor_name, p_actor_email
      );
    else
      v_deployment_id := public.transfer_labour_deployment(
        p_worker_id, p_organization_id,
        nullif(v_assignment->>'contractor_profile_id', '')::uuid,
        nullif(v_assignment->>'company_id', '')::uuid,
        nullif(v_assignment->>'site_id', '')::uuid,
        nullif(v_assignment->>'work_order_id', '')::uuid,
        nullif(v_assignment->>'manpower_work_order_id', '')::uuid,
        v_assignment->>'commercial_model', v_assignment->>'trade',
        v_assignment->>'skill_level', v_assignment->>'wage_type',
        nullif(v_assignment->>'wage_rate', '')::numeric,
        v_effective_from, nullif(v_assignment->>'effective_to', '')::date,
        v_assignment->>'deployment_reason', p_actor_id, p_actor_name, p_actor_email
      );
      update public.labour_deployments
         set labour_trade_id = nullif(v_assignment->>'labour_trade_id', '')::uuid,
             updated_at = now(), updated_by = p_actor_id,
             updated_by_name = p_actor_name, updated_by_email = p_actor_email
       where id = v_deployment_id;
      update public.labour_workers
         set labour_trade_id = nullif(v_assignment->>'labour_trade_id', '')::uuid
       where id = p_worker_id;
    end if;
  end if;

  update public.labour_workers
     set status = 'active',
         current_contractor_profile_id = nullif(v_assignment->>'contractor_profile_id', '')::uuid,
         current_company_id = nullif(v_assignment->>'company_id', '')::uuid,
         current_site_id = nullif(v_assignment->>'site_id', '')::uuid,
         current_work_order_id = nullif(v_assignment->>'work_order_id', '')::uuid,
         labour_trade_id = coalesce(nullif(v_assignment->>'labour_trade_id', '')::uuid, labour_trade_id),
         trade = coalesce(nullif(v_assignment->>'trade', ''), trade),
         skill_level = coalesce(nullif(v_assignment->>'skill_level', ''), skill_level),
         updated_at = now(), updated_by = p_actor_id,
         updated_by_name = p_actor_name, updated_by_email = p_actor_email
   where id = p_worker_id;

  if v_rate is not null then
    select * into v_existing_rate
      from public.labour_wage_rates
     where labour_worker_id = p_worker_id
       and organization_id = p_organization_id
       and effective_from = v_rate_effective_from
       and status <> 'cancelled'
     order by created_at desc
     limit 1
     for update;

    if v_existing_rate.id is not null then
      v_old_values := to_jsonb(v_existing_rate);
      update public.labour_wage_rates
         set deployment_id = v_deployment_id,
             contractor_profile_id = nullif(v_assignment->>'contractor_profile_id', '')::uuid,
             company_id = nullif(v_assignment->>'company_id', '')::uuid,
             site_id = nullif(v_assignment->>'site_id', '')::uuid,
             work_order_id = nullif(v_rate->>'work_order_id', '')::uuid,
             trade_id = nullif(v_rate->>'trade_id', '')::uuid,
             base_rate = v_rate_base,
             wage_type = coalesce(nullif(v_rate->>'wage_type', ''), 'daily'),
             reason = nullif(v_rate->>'reason', ''),
             updated_at = now(), updated_by = p_actor_id,
             updated_by_name = p_actor_name, updated_by_email = p_actor_email
       where id = v_existing_rate.id
       returning id into v_wage_rate_id;
      insert into public.erp_audit_logs (
        organization_id, company_id, site_id, module_code, entity_type,
        record_id, parent_entity_type, parent_record_id, action, description,
        old_values, new_values, source, created_by, created_by_name, created_by_email
      ) values (
        p_organization_id, nullif(v_assignment->>'company_id', '')::uuid,
        nullif(v_assignment->>'site_id', '')::uuid, 'labour_wage_rates',
        'labour_wage_rate', v_wage_rate_id, 'labour_worker', p_worker_id,
        'update', 'Platform Owner corrected/reused a same-date wage rate.',
        v_old_values, v_rate, 'api', p_actor_id, p_actor_name, p_actor_email
      );
    else
      select * into v_current_rate
        from public.labour_wage_rates
       where labour_worker_id = p_worker_id
         and organization_id = p_organization_id
         and status <> 'cancelled'
         and effective_from <= v_rate_effective_from
         and (effective_to is null or effective_to >= v_rate_effective_from)
       order by effective_from desc
       limit 1
       for update;
      v_wage_rate_id := public.update_labour_wage_rate_atomic(
        case when v_current_rate.id is not null and v_current_rate.effective_from < v_rate_effective_from and v_current_rate.effective_to is null then v_current_rate.id else null end,
        case when v_current_rate.id is not null and v_current_rate.effective_from < v_rate_effective_from and v_current_rate.effective_to is null then v_rate_effective_from - 1 else null end,
        p_organization_id, p_worker_id, v_deployment_id,
        nullif(v_assignment->>'contractor_profile_id', '')::uuid,
        nullif(v_assignment->>'company_id', '')::uuid,
        nullif(v_assignment->>'site_id', '')::uuid,
        nullif(v_rate->>'work_order_id', '')::uuid,
        nullif(v_rate->>'trade_id', '')::uuid,
        nullif(v_assignment->>'skill_level', ''), coalesce(nullif(v_rate->>'wage_type', ''), 'daily'),
        v_rate_base, 'hourly', null, false, false,
        v_rate_effective_from, nullif(v_rate->>'effective_to', '')::date,
        'active', nullif(v_rate->>'reason', ''), p_actor_id, p_actor_name, p_actor_email
      );
    end if;
  end if;

  return jsonb_build_object('deployment_id', v_deployment_id, 'wage_rate_id', v_wage_rate_id);
end;
$$;

revoke all on function public.manage_labour_work_atomic(uuid, uuid, jsonb, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.manage_labour_work_atomic(uuid, uuid, jsonb, jsonb, uuid, text, text) to service_role;
