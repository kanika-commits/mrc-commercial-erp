begin;

create or replace function public.transfer_hr_employee_atomic(
  p_employee_id uuid,
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_transfer_effective_date date,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.hr_employees%rowtype;
  v_company public.companies%rowtype;
  v_site public.sites%rowtype;
  v_previous jsonb;
begin
  select * into v_employee
  from public.hr_employees
  where id = p_employee_id
    and organization_id = p_organization_id
    and status <> 'deleted'
  for update;

  if not found then
    raise exception 'Employee was not found in the selected organization.' using errcode = 'P0002';
  end if;

  if v_employee.date_of_joining is not null
     and p_transfer_effective_date < v_employee.date_of_joining then
    raise exception 'Transfer effective date cannot be before the employee''s joining date.' using errcode = 'P0006';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id
    and organization_id = p_organization_id
    and status <> 'deleted';
  if not found then
    raise exception 'Selected company is not available for this organization.' using errcode = 'P0003';
  end if;

  select * into v_site
  from public.sites
  where id = p_site_id
    and organization_id = p_organization_id
    and status <> 'deleted'
    and (company_id = p_company_id or company_id is null);
  if not found then
    raise exception 'Selected site is not available for this company.' using errcode = 'P0004';
  end if;

  if exists (
    select 1
    from public.employee_attendance ea
    left join public.employee_attendance_daily_submissions ds
      on ds.organization_id = ea.organization_id
     and ds.company_id = ea.company_id
     and ds.site_id = ea.site_id
     and ds.attendance_date = ea.attendance_date
    left join public.employee_attendance_periods ep
      on ep.id = ea.period_id
    where ea.employee_id = p_employee_id
      and ea.attendance_date >= p_transfer_effective_date
      and (
        lower(coalesce(ds.status, '')) in ('submitted', 'approved')
        or lower(coalesce(ep.status, '')) in ('submitted', 'level_1_approved', 'level_2_approved', 'finalized')
      )
  ) then
    raise exception 'Official Employee Attendance exists from the transfer effective date onward. Choose a later date or resolve the attendance first.' using errcode = 'P0005';
  end if;

  v_previous := jsonb_build_object(
    'company_id', v_employee.company_id,
    'site_id', v_employee.site_id,
    'department_id', v_employee.department_id,
    'designation_id', v_employee.designation_id,
    'reporting_manager_id', v_employee.reporting_manager_id,
    'employment_type', v_employee.employment_type,
    'shift', v_employee.shift,
    'status', v_employee.status,
    'date_of_joining', v_employee.date_of_joining,
    'date_of_exit', v_employee.date_of_exit
  );

  update public.employee_employment_history
  set effective_to = p_transfer_effective_date - 1,
      updated_by = p_actor_id,
      updated_by_name = p_actor_name,
      updated_by_email = p_actor_email,
      updated_at = now()
  where employee_id = p_employee_id
    and (effective_to is null or effective_to >= p_transfer_effective_date)
    and (effective_from is null or effective_from < p_transfer_effective_date);

  insert into public.employee_employment_history (
    organization_id, employee_id, event_type, event_date, effective_from,
    effective_to, title, description, source, is_manual, previous_values,
    new_values, company_id, site_id, department_id, designation_id,
    reporting_manager_id, employment_type, shift, employment_status,
    created_by, created_by_name, created_by_email, created_at
  ) values (
    p_organization_id, p_employee_id, 'transferred', p_transfer_effective_date,
    p_transfer_effective_date, null, 'Transferred',
    'Company/Site assignment transferred with an effective date.', 'system', false,
    v_previous,
    jsonb_build_object(
      'company_id', p_company_id,
      'site_id', p_site_id,
      'department_id', v_employee.department_id,
      'designation_id', v_employee.designation_id,
      'reporting_manager_id', v_employee.reporting_manager_id,
      'employment_type', v_employee.employment_type,
      'shift', v_employee.shift,
      'status', v_employee.status,
      'date_of_joining', v_employee.date_of_joining,
      'date_of_exit', v_employee.date_of_exit
    ),
    p_company_id, p_site_id, v_employee.department_id, v_employee.designation_id,
    v_employee.reporting_manager_id, v_employee.employment_type, v_employee.shift,
    v_employee.status, p_actor_id, p_actor_name, p_actor_email, now()
  );

  update public.hr_employees
  set company_id = p_company_id,
      site_id = p_site_id,
      updated_by = p_actor_id,
      updated_by_name = p_actor_name,
      updated_by_email = p_actor_email,
      updated_at = now()
  where id = p_employee_id;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'company_id', p_company_id,
    'site_id', p_site_id,
    'transfer_effective_date', p_transfer_effective_date
  );
end;
$$;

revoke all on function public.transfer_hr_employee_atomic(uuid, uuid, uuid, uuid, date, uuid, text, text) from public;
grant execute on function public.transfer_hr_employee_atomic(uuid, uuid, uuid, uuid, date, uuid, text, text) to service_role;

commit;
