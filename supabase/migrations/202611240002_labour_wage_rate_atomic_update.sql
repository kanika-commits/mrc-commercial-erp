-- Atomically close a prior individual labour wage rate and insert its successor.
-- The caller performs authorization and business validation; this function keeps
-- the two writes in one database transaction so an insert failure rolls back
-- the previous-rate close as well.
create or replace function public.update_labour_wage_rate_atomic(
  p_close_previous_rate_id uuid,
  p_close_previous_to date,
  p_organization_id uuid,
  p_labour_worker_id uuid,
  p_deployment_id uuid,
  p_contractor_profile_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_work_order_id uuid,
  p_trade_id uuid,
  p_skill_level text,
  p_wage_type text,
  p_base_rate numeric,
  p_overtime_rate_type text,
  p_overtime_rate numeric,
  p_weekly_off_paid boolean,
  p_holiday_paid boolean,
  p_effective_from date,
  p_effective_to date,
  p_status text,
  p_reason text,
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
  v_rate_id uuid;
begin
  if p_overtime_rate_type not in ('hourly', 'multiplier', 'fixed') then
    raise exception 'Invalid overtime rate type.';
  end if;

  if p_close_previous_rate_id is not null then
    update public.labour_wage_rates
       set effective_to = p_close_previous_to,
           updated_at = now(),
           updated_by = p_actor_id,
           updated_by_name = p_actor_name,
           updated_by_email = p_actor_email
     where id = p_close_previous_rate_id
       and labour_worker_id = p_labour_worker_id
       and organization_id = p_organization_id;
    if not found then
      raise exception 'Previous labour wage rate was not found in the worker organization.';
    end if;
  end if;

  insert into public.labour_wage_rates (
    organization_id, labour_worker_id, deployment_id, contractor_profile_id,
    company_id, site_id, work_order_id, trade_id, skill_level, wage_type,
    base_rate, overtime_rate_type, overtime_rate, weekly_off_paid, holiday_paid,
    effective_from, effective_to, status, reason,
    created_by, created_by_name, created_by_email
  ) values (
    p_organization_id, p_labour_worker_id, p_deployment_id, p_contractor_profile_id,
    p_company_id, p_site_id, p_work_order_id, p_trade_id, p_skill_level, p_wage_type,
    p_base_rate, p_overtime_rate_type, p_overtime_rate, coalesce(p_weekly_off_paid, false),
    coalesce(p_holiday_paid, false), p_effective_from, p_effective_to, p_status, p_reason,
    p_actor_id, p_actor_name, p_actor_email
  ) returning id into v_rate_id;

  return v_rate_id;
end;
$$;

revoke all on function public.update_labour_wage_rate_atomic(
  uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  numeric, text, numeric, boolean, boolean, date, date, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.update_labour_wage_rate_atomic(
  uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  numeric, text, numeric, boolean, boolean, date, date, text, text, uuid, text, text
) to service_role;
