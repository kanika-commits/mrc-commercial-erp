begin;

create table if not exists public.hr_employee_transfer_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.hr_employees(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  effective_date date not null,
  status text not null default 'pending' check (status in ('pending','applied','failed','cancelled')),
  failure_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  applied_at timestamptz,
  applied_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists hr_employee_transfer_schedules_one_pending
  on public.hr_employee_transfer_schedules(employee_id)
  where status = 'pending';
create index if not exists hr_employee_transfer_schedules_due_idx
  on public.hr_employee_transfer_schedules(status, effective_date);
create index if not exists hr_employee_transfer_schedules_employee_idx
  on public.hr_employee_transfer_schedules(employee_id, effective_date desc);

alter table public.hr_employee_transfer_schedules enable row level security;
revoke all on table public.hr_employee_transfer_schedules from public, anon, authenticated;
grant all on table public.hr_employee_transfer_schedules to service_role;

create or replace function public.schedule_hr_employee_transfer(
  p_employee_id uuid, p_organization_id uuid, p_company_id uuid, p_site_id uuid,
  p_effective_date date, p_actor_id uuid, p_actor_name text, p_actor_email text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee public.hr_employees%rowtype; v_id uuid;
begin
  if p_effective_date <= (current_timestamp at time zone 'Asia/Kolkata')::date then
    raise exception 'Scheduled transfers must use a future Asia/Kolkata business date.' using errcode = 'P0007';
  end if;
  select * into v_employee from public.hr_employees where id=p_employee_id and organization_id=p_organization_id and status <> 'deleted' for update;
  if not found then raise exception 'Employee was not found in the selected organization.' using errcode='P0002'; end if;
  if not exists (select 1 from public.companies where id=p_company_id and organization_id=p_organization_id and status <> 'deleted') then
    raise exception 'Selected company is not available for this organization.' using errcode='P0003';
  end if;
  if not exists (select 1 from public.sites where id=p_site_id and organization_id=p_organization_id and status <> 'deleted') then
    raise exception 'Selected site is not available for this organization.' using errcode='P0004';
  end if;
  if exists (select 1 from public.hr_employee_transfer_schedules where employee_id=p_employee_id and status='pending') then
    raise exception 'A pending transfer already exists for this employee.' using errcode='23505';
  end if;
  insert into public.hr_employee_transfer_schedules(organization_id,employee_id,company_id,site_id,effective_date,created_by,created_by_name,created_by_email)
  values(p_organization_id,p_employee_id,p_company_id,p_site_id,p_effective_date,p_actor_id,p_actor_name,p_actor_email) returning id into v_id;
  return jsonb_build_object('id',v_id,'employee_id',p_employee_id,'company_id',p_company_id,'site_id',p_site_id,'effective_date',p_effective_date,'status','pending');
end; $$;

create or replace function public.cancel_hr_employee_transfer(p_schedule_id uuid, p_organization_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.hr_employee_transfer_schedules%rowtype;
begin
  select * into v from public.hr_employee_transfer_schedules where id=p_schedule_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Scheduled transfer was not found.'; end if;
  if v.status <> 'pending' then raise exception 'Only pending transfers can be cancelled.'; end if;
  update public.hr_employee_transfer_schedules set status='cancelled', cancelled_at=now(), cancelled_by=p_actor_id, updated_at=now() where id=v.id;
  return jsonb_build_object('id',v.id,'status','cancelled');
end; $$;

create or replace function public.process_due_hr_employee_transfers(p_business_date date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.hr_employee_transfer_schedules%rowtype; v_result jsonb; v_applied integer:=0; v_failed integer:=0; v_date date:=coalesce(p_business_date,(current_timestamp at time zone 'Asia/Kolkata')::date);
begin
  for v in select * from public.hr_employee_transfer_schedules where status='pending' and effective_date <= v_date order by effective_date,id for update skip locked loop
    begin
      perform 1 from public.hr_employees where id=v.employee_id for update;
      if not exists (select 1 from public.companies where id=v.company_id and organization_id=v.organization_id and status <> 'deleted') then raise exception 'Destination company is no longer available.'; end if;
      if not exists (select 1 from public.sites where id=v.site_id and organization_id=v.organization_id and status <> 'deleted') then raise exception 'Destination site is no longer available.'; end if;
      if exists (select 1 from public.employee_attendance ea left join public.employee_attendance_daily_submissions ds on ds.organization_id=ea.organization_id and ds.company_id=ea.company_id and ds.site_id=ea.site_id and ds.attendance_date=ea.attendance_date left join public.employee_attendance_periods ep on ep.id=ea.period_id where ea.employee_id=v.employee_id and ea.attendance_date>=v.effective_date and (lower(coalesce(ds.status,'')) in ('submitted','approved') or lower(coalesce(ep.status,'')) in ('submitted','level_1_approved','level_2_approved','finalized'))) then raise exception 'Protected attendance exists from the effective date onward.'; end if;
      if exists (select 1 from public.employee_attendance ea where ea.employee_id=v.employee_id and ea.attendance_date>=v.effective_date) then raise exception 'Attendance exists from the effective date onward and must be reconciled before transfer.'; end if;
      select public.transfer_hr_employee_atomic(v.employee_id,v.organization_id,v.company_id,v.site_id,v.effective_date,v.created_by,v.created_by_name,v.created_by_email) into v_result;
      update public.hr_employee_transfer_schedules set status='applied', applied_at=now(), applied_by=v.created_by, updated_at=now(), failure_reason=null where id=v.id and status='pending';
      v_applied:=v_applied+1;
    exception when others then
      update public.hr_employee_transfer_schedules set status='failed', failure_reason=left(sqlerrm,1000), updated_at=now() where id=v.id and status='pending';
      v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('business_date',v_date,'applied',v_applied,'failed',v_failed);
end; $$;

create or replace function public.reschedule_hr_employee_transfer(p_schedule_id uuid, p_organization_id uuid, p_effective_date date, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.hr_employee_transfer_schedules%rowtype;
begin
  if p_effective_date <= (current_timestamp at time zone 'Asia/Kolkata')::date then raise exception 'Rescheduled transfers must use a future Asia/Kolkata business date.'; end if;
  select * into v from public.hr_employee_transfer_schedules where id=p_schedule_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Scheduled transfer was not found.'; end if;
  if v.status not in ('pending', 'failed') then raise exception 'Only pending or failed transfers can be rescheduled.'; end if;
  perform 1 from public.hr_employees where id=v.employee_id and organization_id=p_organization_id for update;
  if exists (select 1 from public.hr_employee_transfer_schedules where employee_id=v.employee_id and status='pending' and id<>v.id) then
    raise exception 'Another pending transfer already exists for this employee.' using errcode='23505';
  end if;
  update public.hr_employee_transfer_schedules set status='pending', effective_date=p_effective_date, updated_at=now(), failure_reason=null where id=v.id;
  return jsonb_build_object('id',v.id,'effective_date',p_effective_date,'status','pending');
end; $$;

revoke all on function public.schedule_hr_employee_transfer(uuid,uuid,uuid,uuid,date,uuid,text,text) from public, anon, authenticated;
revoke all on function public.cancel_hr_employee_transfer(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.process_due_hr_employee_transfers(date) from public, anon, authenticated;
revoke all on function public.reschedule_hr_employee_transfer(uuid,uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.schedule_hr_employee_transfer(uuid,uuid,uuid,uuid,date,uuid,text,text) to service_role;
grant execute on function public.cancel_hr_employee_transfer(uuid,uuid,uuid) to service_role;
grant execute on function public.process_due_hr_employee_transfers(date) to service_role;
grant execute on function public.reschedule_hr_employee_transfer(uuid,uuid,date,uuid) to service_role;

commit;
