-- Atomically update selected Labour Daily Rates and convert eligible current
-- deployments whose linked Commercial Work Order is now Daily Wage.
create or replace function public.bulk_update_labour_daily_rates_atomic(
  p_worker_ids uuid[],
  p_base_rate numeric,
  p_effective_from date,
  p_reason text,
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
  v_deployment public.labour_deployments%rowtype;
  v_work_order public.work_orders%rowtype;
  v_rate public.labour_wage_rates%rowtype;
  v_close_date date;
  v_rate_id uuid;
  v_worker_id uuid;
  v_ids uuid[];
  v_rate_ids uuid[] := '{}'::uuid[];
  v_deployment_count integer;
  v_updated integer := 0;
begin
  select array_agg(distinct worker_id order by worker_id)
    into v_ids
  from unnest(coalesce(p_worker_ids, '{}'::uuid[])) as input(worker_id);

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'Select at least one labourer.';
  end if;
  if cardinality(v_ids) > 200 then
    raise exception 'A maximum of 200 labourers can be updated at once.';
  end if;
  if p_base_rate is null or p_base_rate <= 0 then
    raise exception 'New Daily Rate must be a positive amount.';
  end if;
  if p_effective_from is null then
    raise exception 'Effective from date is required.';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'Reason must be at least 10 characters.';
  end if;

  foreach v_worker_id in array v_ids loop
    select * into v_worker
      from public.labour_workers
     where id = v_worker_id
       and status = 'active'
     for update;
    if not found then
      raise exception 'Selected labourer is not active.';
    end if;

    select count(*) into v_deployment_count
      from public.labour_deployments
     where labour_worker_id = v_worker_id
       and status = 'active'
       and effective_to is null;
    if v_deployment_count <> 1 then
      raise exception 'Selected labourer must have exactly one active deployment.';
    end if;

    select * into v_deployment
      from public.labour_deployments
     where labour_worker_id = v_worker_id
       and status = 'active'
       and effective_to is null
     for update;

    if v_deployment.commercial_model <> 'daily_wage' then
      if v_deployment.work_order_id is null then
        raise exception 'Selected labourer is not linked to a Daily Wage Work Order.';
      end if;
      select * into v_work_order
        from public.work_orders
       where id = v_deployment.work_order_id
         and organization_id = v_deployment.organization_id
         and company_id = v_deployment.company_id
         and site_id = v_deployment.site_id
         and status = 'active'
         and approval_status = 'approved'
         and is_deleted = false
       for share;
      if not found or v_work_order.wo_type <> 'Daily Wage' then
        raise exception 'Selected labourer is not linked to an approved Daily Wage Work Order.';
      end if;
    end if;

    select * into v_rate
      from public.labour_wage_rates
     where labour_worker_id = v_worker_id
       and status <> 'cancelled'
       and effective_from <= p_effective_from
       and (effective_to is null or effective_to >= p_effective_from)
     order by effective_from desc
     limit 1
     for update;

    if v_rate.id is not null and v_rate.effective_from < p_effective_from and v_rate.effective_to is null then
      v_close_date := p_effective_from - 1;
      update public.labour_wage_rates
         set effective_to = v_close_date,
             updated_at = now(),
             updated_by = p_actor_id,
             updated_by_name = p_actor_name,
             updated_by_email = p_actor_email
       where id = v_rate.id;
    else
      v_close_date := null;
    end if;

    if exists (
      select 1
        from public.labour_wage_rates overlapping
       where overlapping.labour_worker_id = v_worker_id
         and overlapping.status <> 'cancelled'
         and overlapping.id is distinct from v_rate.id
         and overlapping.effective_from <= p_effective_from
         and (overlapping.effective_to is null or overlapping.effective_to >= p_effective_from)
    ) then
      raise exception 'Selected labourer has an overlapping wage-rate period.';
    end if;

    insert into public.labour_wage_rates (
      organization_id, labour_worker_id, deployment_id, contractor_profile_id,
      company_id, site_id, work_order_id, trade_id, skill_level, wage_type,
      base_rate, overtime_rate_type, effective_from, effective_to, status, reason,
      created_by, created_by_name, created_by_email
    ) values (
      v_worker.organization_id, v_worker.id, v_deployment.id,
      v_deployment.contractor_profile_id, v_deployment.company_id,
      v_deployment.site_id, v_deployment.work_order_id,
      v_deployment.labour_trade_id, v_deployment.skill_level, 'daily',
      p_base_rate, 'hourly', p_effective_from, null, 'active', btrim(p_reason),
      p_actor_id, p_actor_name, p_actor_email
    ) returning id into v_rate_id;

    update public.labour_deployments
       set commercial_model = 'daily_wage',
           wage_type = 'daily',
           wage_rate = p_base_rate,
           updated_at = now(),
           updated_by = p_actor_id,
           updated_by_name = p_actor_name,
           updated_by_email = p_actor_email
     where id = v_deployment.id;

    insert into public.erp_audit_logs (
      organization_id, company_id, site_id, module_code, entity_type, record_id,
      parent_entity_type, parent_record_id, action, description, old_values,
      new_values, source, created_by, created_by_name, created_by_email
    ) values (
      v_worker.organization_id, v_deployment.company_id, v_deployment.site_id,
      'labour_deployment_daily_wage_conversion', 'labour_deployment', v_deployment.id,
      'labour_worker', v_worker.id, 'update',
      'Converted the current labour deployment to Daily Wage during bulk rate update.',
      jsonb_build_object('commercial_model', v_deployment.commercial_model,
                         'wage_type', v_deployment.wage_type,
                         'wage_rate', v_deployment.wage_rate,
                         'work_order_id', v_deployment.work_order_id),
      jsonb_build_object('commercial_model', 'daily_wage', 'wage_type', 'daily',
                         'wage_rate', p_base_rate, 'work_order_id', v_deployment.work_order_id,
                         'rate_id', v_rate_id),
      'system', p_actor_id, p_actor_name, p_actor_email
    );

    v_rate_ids := array_append(v_rate_ids, v_rate_id);
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'wage_rate_ids', to_jsonb(v_rate_ids));
end;
$$;

revoke all on function public.bulk_update_labour_daily_rates_atomic(uuid[], numeric, date, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bulk_update_labour_daily_rates_atomic(uuid[], numeric, date, text, uuid, text, text) to service_role;
