begin;

create or replace function public.lock_hr_attendance_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('hr-attendance-period:' || new.id::text, 0)
  );
  return new;
end;
$$;

drop trigger if exists hr_attendance_period_serialization on public.employee_attendance_periods;
create trigger hr_attendance_period_serialization
before update on public.employee_attendance_periods
for each row execute function public.lock_hr_attendance_period();

revoke all on function public.lock_hr_attendance_period() from public, anon, authenticated;
grant execute on function public.lock_hr_attendance_period() to service_role;

create or replace function public.submit_hr_employee_attendance_atomic(
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_period_id uuid,
  p_attendance_date date,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.employee_attendance_periods%rowtype;
  v_daily public.employee_attendance_daily_submissions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(
    hashtextextended('hr-attendance-period:' || p_period_id::text, 0)
  );

  select * into v_period
    from public.employee_attendance_periods
   where id = p_period_id
     and organization_id = p_organization_id
     and company_id = p_company_id
     and site_id = p_site_id
     and period_month = date_trunc('month', p_attendance_date)::date;
  if not found then
    raise exception 'Attendance period does not match the selected organization, company, site and date.' using errcode = 'P0011';
  end if;

  if lower(coalesce(v_period.status, '')) in ('submitted', 'approved', 'level_1_approved', 'level_2_approved', 'finalized') then
    raise exception 'This attendance date is already submitted or approved.' using errcode = 'P0010';
  end if;

  if exists (
    select 1
      from public.employee_attendance_daily_submissions ds
     where ds.organization_id = p_organization_id
       and ds.company_id = p_company_id
       and ds.site_id = p_site_id
       and ds.attendance_date = p_attendance_date
       and lower(coalesce(ds.status, '')) not in ('draft', 'reopened')
  ) then
    raise exception 'This attendance date is already submitted or approved.' using errcode = 'P0010';
  end if;

  if not exists (
    select 1 from public.employee_attendance_policies policy
     where policy.organization_id = p_organization_id
       and policy.site_id = p_site_id
       and policy.status = 'active'
  ) then
    raise exception 'Employee Attendance Policy is not configured for the selected site.' using errcode = 'P0012';
  end if;

  if not exists (
    select 1 from public.employee_attendance ea
     where ea.organization_id = p_organization_id
       and ea.company_id = p_company_id
       and ea.site_id = p_site_id
       and ea.period_id = p_period_id
       and ea.attendance_date = p_attendance_date
  ) then
    raise exception 'Save attendance before submitting this date.' using errcode = 'P0013';
  end if;

  if exists (
    select 1
      from public.employee_attendance ea
      join public.hr_employee_transfer_schedules ts
        on ts.employee_id = ea.employee_id
       and ts.organization_id = ea.organization_id
       and ts.status = 'pending'
       and ts.effective_date <= p_attendance_date
     where ea.organization_id = p_organization_id
       and ea.company_id = p_company_id
       and ea.site_id = p_site_id
       and ea.period_id = p_period_id
       and ea.attendance_date = p_attendance_date
  ) then
    raise exception 'A scheduled employee transfer is due. Apply the transfer before submitting attendance for this date.' using errcode = 'P0008';
  end if;

  select * into v_daily
    from public.employee_attendance_daily_submissions ds
   where ds.organization_id = p_organization_id
     and ds.company_id = p_company_id
     and ds.site_id = p_site_id
     and ds.attendance_date = p_attendance_date
   for update;

  if not found then
    insert into public.employee_attendance_daily_submissions (
      organization_id, company_id, site_id, period_id, attendance_date,
      status, created_by, created_by_name, created_by_email,
      updated_by, updated_by_name, updated_by_email, created_at, updated_at
    ) values (
      p_organization_id, p_company_id, p_site_id, p_period_id, p_attendance_date,
      'draft', p_actor_id, p_actor_name, p_actor_email,
      p_actor_id, p_actor_name, p_actor_email, v_now, v_now
    ) returning * into v_daily;
  end if;

  update public.employee_attendance_daily_submissions
     set status = 'submitted',
         submitted_by = p_actor_id,
         submitted_by_name = p_actor_name,
         submitted_by_email = p_actor_email,
         submitted_at = v_now,
         updated_by = p_actor_id,
         updated_by_name = p_actor_name,
         updated_by_email = p_actor_email,
         updated_at = v_now
   where id = v_daily.id
   returning * into v_daily;

  return to_jsonb(v_daily);
end;
$$;

revoke all on function public.submit_hr_employee_attendance_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text)
  from public, anon, authenticated;

grant execute on function public.submit_hr_employee_attendance_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text)
  to service_role;

create or replace function public.save_hr_employee_attendance_atomic(
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_employee_id uuid,
  p_period_id uuid,
  p_attendance_date date,
  p_status text,
  p_remarks text,
  p_backdated_reason text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.hr_employees%rowtype;
  v_row public.employee_attendance%rowtype;
begin
  select * into v_employee
  from public.hr_employees
  where id = p_employee_id
    and organization_id = p_organization_id
    and status <> 'deleted'
  for update;
  if not found then raise exception 'Employee is not available in this organization.' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hr-attendance-period:' || p_period_id::text, 0)
  );

  if exists (
    select 1 from public.hr_employee_transfer_schedules
    where employee_id = p_employee_id and organization_id = p_organization_id
      and status = 'pending' and effective_date <= p_attendance_date
  ) then
    raise exception 'A scheduled transfer is due for this employee. Apply the transfer before saving attendance.' using errcode = 'P0008';
  end if;

  if v_employee.company_id is distinct from p_company_id or v_employee.site_id is distinct from p_site_id then
    raise exception 'Attendance site does not match the employee assignment for this date.' using errcode = 'P0009';
  end if;

  if exists (
    select 1
      from public.employee_attendance_periods ep
     where ep.id = p_period_id
       and ep.organization_id = p_organization_id
       and ep.company_id = p_company_id
       and ep.site_id = p_site_id
       and ep.period_month = date_trunc('month', p_attendance_date)::date
       and lower(coalesce(ep.status, '')) in ('submitted', 'approved', 'level_1_approved', 'level_2_approved', 'finalized')
  ) then
    raise exception 'This attendance period is already submitted or approved and is read-only.' using errcode = 'P0010';
  end if;

  if not exists (
    select 1
      from public.employee_attendance_periods ep
     where ep.id = p_period_id
       and ep.organization_id = p_organization_id
       and ep.company_id = p_company_id
       and ep.site_id = p_site_id
       and ep.period_month = date_trunc('month', p_attendance_date)::date
  ) then
    raise exception 'Attendance period does not match the selected organization, company, site and date.' using errcode = 'P0011';
  end if;

  if exists (
    select 1 from public.employee_attendance_daily_submissions
    where organization_id = p_organization_id and company_id = p_company_id
      and site_id = p_site_id and attendance_date = p_attendance_date
      and lower(status) in ('submitted', 'approved')
  ) then
    raise exception 'This attendance date is already submitted or approved and is read-only.' using errcode = 'P0010';
  end if;

  insert into public.employee_attendance (
    organization_id, company_id, site_id, employee_id, period_id,
    attendance_date, status, remarks, source, backdated_reason,
    created_by, created_by_name, created_by_email,
    updated_by, updated_by_name, updated_by_email, updated_at
  ) values (
    p_organization_id, p_company_id, p_site_id, p_employee_id, p_period_id,
    p_attendance_date, p_status, nullif(btrim(coalesce(p_remarks, '')), ''), 'manual',
    nullif(btrim(coalesce(p_backdated_reason, '')), ''),
    p_actor_id, p_actor_name, p_actor_email,
    p_actor_id, p_actor_name, p_actor_email, now()
  )
  on conflict (employee_id, attendance_date) do update set
    company_id = excluded.company_id,
    site_id = excluded.site_id,
    period_id = excluded.period_id,
    status = excluded.status,
    remarks = excluded.remarks,
    source = excluded.source,
    backdated_reason = excluded.backdated_reason,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_hr_employee_attendance_atomic(uuid,uuid,uuid,uuid,uuid,date,text,text,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.save_hr_employee_attendance_atomic(uuid,uuid,uuid,uuid,uuid,date,text,text,text,uuid,text,text) to service_role;

commit;
