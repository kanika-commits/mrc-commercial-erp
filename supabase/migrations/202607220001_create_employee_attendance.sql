begin;

do $$
begin
  if to_regclass('public.erp_modules') is not null then
    insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
    select 'hr', 'hr_attendance', 'Mark Attendance', '/hr/attendance/daily', 30, 'active'
    where not exists (select 1 from public.erp_modules where module_code = 'hr_attendance');
  end if;
end $$;

do $$
begin
  if to_regclass('public.roles') is not null and to_regclass('public.role_permissions') is not null then
    insert into public.role_permissions (role_id, module_code, action_code, allowed)
    select roles.id, permissions.module_code, permissions.action_code, true
    from public.roles
    cross join (
      values
        ('hr_attendance', 'view'),
        ('hr_attendance', 'add'),
        ('hr_attendance', 'edit'),
        ('hr_attendance', 'submit'),
        ('hr_attendance', 'export'),
        ('hr_attendance_approval', 'view'),
        ('hr_attendance_approval', 'approve'),
        ('hr_attendance_approval', 'reject')
    ) as permissions(module_code, action_code)
    where roles.role_code = 'super_admin'
      and not exists (
        select 1
        from public.role_permissions existing
        where existing.role_id = roles.id
          and existing.module_code = permissions.module_code
          and existing.action_code = permissions.action_code
      );
  end if;
end $$;

create table if not exists public.employee_attendance_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  period_month date not null,
  status text not null default 'draft',
  submitted_by uuid null,
  submitted_by_name text null,
  submitted_by_email text null,
  submitted_at timestamptz null,
  finalized_by uuid null,
  finalized_by_name text null,
  finalized_by_email text null,
  finalized_at timestamptz null,
  reopened_by uuid null,
  reopened_by_name text null,
  reopened_by_email text null,
  reopened_at timestamptz null,
  reopen_reason text null,
  send_back_reason text null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_by_name text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_by uuid null,
  updated_by_name text null,
  updated_by_email text null,
  updated_at timestamptz not null default now(),
  constraint employee_attendance_periods_status_check
    check (status in ('draft', 'submitted', 'finalized', 'reopened', 'cancelled')),
  constraint employee_attendance_periods_month_start_check
    check (period_month = date_trunc('month', period_month)::date),
  constraint employee_attendance_periods_unique_scope_month
    unique (organization_id, company_id, site_id, period_month)
);

create table if not exists public.employee_attendance_day_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  attendance_date date not null,
  is_locked boolean not null default true,
  locked_by uuid null,
  locked_by_name text null,
  locked_by_email text null,
  locked_at timestamptz null,
  unlocked_by uuid null,
  unlocked_by_name text null,
  unlocked_by_email text null,
  unlocked_at timestamptz null,
  unlock_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_attendance_day_locks_unique_scope_date
    unique (organization_id, company_id, site_id, attendance_date)
);

create table if not exists public.employee_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  period_id uuid not null references public.employee_attendance_periods(id) on delete restrict,
  attendance_date date not null,
  status text not null,
  check_in time null,
  check_out time null,
  worked_minutes integer null,
  overtime_minutes integer null,
  remarks text null,
  source text not null default 'manual',
  backdated_reason text null,
  created_by uuid null,
  created_by_name text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_by uuid null,
  updated_by_name text null,
  updated_by_email text null,
  updated_at timestamptz not null default now(),
  constraint employee_attendance_status_check
    check (status in ('present', 'absent', 'half_day', 'paid_leave', 'unpaid_leave', 'weekly_off', 'holiday', 'work_from_home', 'on_duty')),
  constraint employee_attendance_source_check
    check (source in ('manual', 'system', 'import')),
  constraint employee_attendance_unique_employee_date
    unique (employee_id, attendance_date)
);

create index if not exists employee_attendance_scope_date_idx
  on public.employee_attendance (organization_id, company_id, site_id, attendance_date);

create index if not exists employee_attendance_period_employee_idx
  on public.employee_attendance (period_id, employee_id);

create index if not exists employee_attendance_period_status_idx
  on public.employee_attendance_periods (organization_id, company_id, site_id, period_month, status);

alter table public.employee_attendance_periods enable row level security;
alter table public.employee_attendance_day_locks enable row level security;
alter table public.employee_attendance enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on table public.employee_attendance_periods to authenticated;
    grant select, insert, update, delete on table public.employee_attendance_day_locks to authenticated;
    grant select, insert, update, delete on table public.employee_attendance to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.employee_attendance_periods to service_role;
    grant all on table public.employee_attendance_day_locks to service_role;
    grant all on table public.employee_attendance to service_role;
  end if;
end $$;

commit;
