-- Align Daily Wage deployment transfers with the existing labour Work Order model.
-- Apply manually after review; this migration changes no business data.
create or replace function public.transfer_labour_deployment(
  p_worker_id uuid, p_organization_id uuid, p_contractor_profile_id uuid,
  p_company_id uuid, p_site_id uuid, p_work_order_id uuid,
  p_manpower_work_order_id uuid, p_commercial_model text, p_trade text,
  p_skill_level text, p_wage_type text, p_wage_rate numeric,
  p_effective_from date, p_effective_to date, p_deployment_reason text,
  p_actor_id uuid, p_actor_name text, p_actor_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.labour_workers%rowtype;
  v_open public.labour_deployments%rowtype;
  v_work_order public.work_orders%rowtype;
  v_vendor_id uuid;
  v_source_rate numeric;
  v_close_date date;
  v_deployment_id uuid;
begin
  if p_commercial_model not in ('contract_basis', 'daily_wage') then raise exception 'Invalid commercial model.'; end if;
  if p_effective_from is null then raise exception 'Effective date is required.'; end if;
  if p_work_order_id is null then raise exception 'Deployment requires an approved Work Order.'; end if;

  select * into v_worker from public.labour_workers
  where id = p_worker_id and organization_id = p_organization_id and status <> 'deleted' for update;
  if not found then raise exception 'Labourer not found.'; end if;

  select * into v_work_order from public.work_orders
  where id = p_work_order_id
    and organization_id = p_organization_id and company_id = p_company_id and site_id = p_site_id
    and status = 'active' and approval_status = 'approved' and is_deleted = false;
  if not found then raise exception 'Selected Work Order is not approved for this company and site.'; end if;
  if p_commercial_model = 'daily_wage' and v_work_order.wo_type <> 'Daily Wage' then
    raise exception 'Selected Work Order is not a Daily Wage Work Order.';
  end if;

  select cp.vendor_id into v_vendor_id from public.labour_contractor_profiles cp
  where cp.id = p_contractor_profile_id and cp.organization_id = p_organization_id and cp.contractor_status = 'active';
  if v_vendor_id is null then raise exception 'Selected labour contractor is not available.'; end if;
  if not exists (select 1 from public.work_order_vendors wv where wv.work_order_id = p_work_order_id and wv.vendor_id = v_vendor_id) then
    raise exception 'Selected Work Order is not linked to this labour contractor.';
  end if;

  if p_commercial_model = 'contract_basis' and p_manpower_work_order_id is null then
    raise exception 'Contractual Labour requires an Approved Manpower Work Order.';
  end if;
  if p_commercial_model = 'daily_wage' then
    select d.wage_rate into v_source_rate from public.labour_deployments d
    where d.organization_id = p_organization_id and d.company_id = p_company_id and d.site_id = p_site_id
      and d.work_order_id = p_work_order_id and d.labour_trade_id = (select id from public.labour_trades where organization_id = p_organization_id and trade_name = p_trade limit 1)
      and d.commercial_model = 'daily_wage' and d.status = 'active'
      and d.effective_from <= p_effective_from and (d.effective_to is null or d.effective_to >= p_effective_from)
      and d.wage_rate is not null order by d.effective_from desc limit 1;
    if v_source_rate is null or v_source_rate <= 0 then raise exception 'Selected Daily Wage Work Order has no applicable rate for this Labour Category and date.'; end if;
  end if;

  select * into v_open from public.labour_deployments
  where labour_worker_id = p_worker_id and status = 'active' and effective_to is null for update;
  if exists (select 1 from public.labour_deployments d where d.labour_worker_id = p_worker_id
    and d.id is distinct from coalesce(v_open.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and d.effective_from <= coalesce(p_effective_to, '9999-12-31'::date)
    and coalesce(d.effective_to, '9999-12-31'::date) >= p_effective_from) then
    raise exception 'Deployment dates overlap an existing deployment.';
  end if;
  if v_open.id is not null then
    v_close_date := p_effective_from - 1;
    if v_close_date < v_open.effective_from then raise exception 'Transfer date must be after the current deployment start date.'; end if;
    update public.labour_deployments set effective_to = v_close_date, status = 'ended', updated_at = now(), updated_by = p_actor_id, updated_by_name = p_actor_name, updated_by_email = p_actor_email where id = v_open.id;
  end if;

  insert into public.labour_deployments (organization_id, labour_worker_id, contractor_profile_id, company_id, site_id, work_order_id, manpower_work_order_id, commercial_model, trade, skill_level, wage_type, wage_rate, effective_from, effective_to, status, deployment_reason, created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, updated_at)
  values (p_organization_id, p_worker_id, p_contractor_profile_id, p_company_id, p_site_id, p_work_order_id, p_manpower_work_order_id, p_commercial_model, p_trade, p_skill_level, p_wage_type, case when p_commercial_model = 'daily_wage' then v_source_rate else p_wage_rate end, p_effective_from, p_effective_to, case when p_effective_to is null then 'active' else 'ended' end, p_deployment_reason, p_actor_id, p_actor_name, p_actor_email, p_actor_id, p_actor_name, p_actor_email, now()) returning id into v_deployment_id;

  update public.labour_workers set current_contractor_profile_id = p_contractor_profile_id, current_company_id = p_company_id, current_site_id = p_site_id, current_work_order_id = p_work_order_id, trade = coalesce(p_trade, trade), skill_level = coalesce(p_skill_level, skill_level), updated_at = now(), updated_by = p_actor_id, updated_by_name = p_actor_name, updated_by_email = p_actor_email where id = p_worker_id;
  return v_deployment_id;
end;
$$;
