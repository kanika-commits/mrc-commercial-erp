create or replace function public.reactivate_labour_deployment(
  p_worker_id uuid,
  p_organization_id uuid,
  p_contractor_profile_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_work_order_id uuid,
  p_manpower_work_order_id uuid,
  p_commercial_model text,
  p_trade text,
  p_labour_trade_id uuid,
  p_skill_level text,
  p_wage_type text,
  p_wage_rate numeric,
  p_effective_from date,
  p_effective_to date,
  p_deployment_reason text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.labour_workers%rowtype;
  v_deployment_id uuid;
begin
  if p_commercial_model not in ('contract_basis', 'daily_wage') then
    raise exception 'Invalid commercial model.';
  end if;
  if p_commercial_model = 'daily_wage' and p_work_order_id is null then
    raise exception 'Daily-wage reactivation requires a Commercial Work Order.';
  end if;
  if p_commercial_model = 'daily_wage' and (p_wage_rate is null or p_wage_rate <= 0) then
    raise exception 'Daily-wage reactivation requires a positive Daily Rate.';
  end if;
  if p_commercial_model = 'contract_basis' and p_manpower_work_order_id is null then
    raise exception 'Contractual reactivation requires an Approved Manpower Work Order.';
  end if;
  if p_effective_from is null then
    raise exception 'Effective date is required.';
  end if;

  select * into v_worker
  from public.labour_workers
  where id = p_worker_id
    and organization_id = p_organization_id
    and status = 'inactive'
  for update;

  if not found then
    raise exception 'Only an inactive labourer can be reactivated.';
  end if;

  if exists (
    select 1 from public.labour_deployments
    where labour_worker_id = p_worker_id
      and status = 'active'
      and effective_to is null
  ) then
    raise exception 'Labourer already has an active deployment.';
  end if;

  if exists (
    select 1 from public.labour_deployments d
    where d.labour_worker_id = p_worker_id
      and d.effective_from <= coalesce(p_effective_to, '9999-12-31'::date)
      and coalesce(d.effective_to, '9999-12-31'::date) >= p_effective_from
  ) then
    raise exception 'Deployment dates overlap an existing deployment.';
  end if;

  insert into public.labour_deployments (
    organization_id, labour_worker_id, contractor_profile_id, company_id, site_id,
    work_order_id, manpower_work_order_id, commercial_model, trade, labour_trade_id,
    skill_level, wage_type, wage_rate, effective_from, effective_to, status,
    deployment_reason, created_by, created_by_name, created_by_email, updated_by,
    updated_by_name, updated_by_email, updated_at
  ) values (
    p_organization_id, p_worker_id, p_contractor_profile_id, p_company_id, p_site_id,
    p_work_order_id, p_manpower_work_order_id, p_commercial_model, p_trade, p_labour_trade_id,
    p_skill_level, p_wage_type, p_wage_rate, p_effective_from, p_effective_to,
    case when p_effective_to is null then 'active' else 'ended' end,
    p_deployment_reason, p_actor_id, p_actor_name, p_actor_email, p_actor_id,
    p_actor_name, p_actor_email, now()
  ) returning id into v_deployment_id;

  update public.labour_workers
  set status = 'active',
      current_contractor_profile_id = p_contractor_profile_id,
      current_company_id = p_company_id,
      current_site_id = p_site_id,
      current_work_order_id = p_work_order_id,
      labour_trade_id = coalesce(p_labour_trade_id, labour_trade_id),
      trade = coalesce(p_trade, trade),
      skill_level = coalesce(p_skill_level, skill_level),
      updated_at = now(),
      updated_by = p_actor_id,
      updated_by_name = p_actor_name,
      updated_by_email = p_actor_email
  where id = p_worker_id;

  return v_deployment_id;
end;
$$;
