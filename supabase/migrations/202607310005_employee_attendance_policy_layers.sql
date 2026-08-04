alter table public.employee_attendance_policies
  add column if not exists standard_working_hours integer not null default 8,
  add column if not exists approval_level_count integer not null default 1,
  add column if not exists approval_workflow_version integer not null default 1,
  add column if not exists lock_after_hours integer not null default 5,
  add column if not exists post_lock_edit_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_attendance_policies_standard_working_hours_check'
      and conrelid = 'public.employee_attendance_policies'::regclass
  ) then
    alter table public.employee_attendance_policies
      add constraint employee_attendance_policies_standard_working_hours_check
      check (standard_working_hours = 8);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_attendance_policies_approval_level_count_check'
      and conrelid = 'public.employee_attendance_policies'::regclass
  ) then
    alter table public.employee_attendance_policies
      add constraint employee_attendance_policies_approval_level_count_check
      check (approval_level_count between 0 and 3);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_attendance_policies_lock_after_hours_check'
      and conrelid = 'public.employee_attendance_policies'::regclass
  ) then
    alter table public.employee_attendance_policies
      add constraint employee_attendance_policies_lock_after_hours_check
      check (lock_after_hours between 0 and 168);
  end if;
end $$;

create table if not exists public.employee_attendance_policy_layers (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.employee_attendance_policies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  workflow_version integer not null check (workflow_version >= 1),
  level_sequence integer not null check (level_sequence between 1 and 3),
  stage_name text not null,
  approver_user_id uuid not null references public.profiles(id) on delete restrict,
  approver_employee_id uuid references public.hr_employees(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_attendance_policy_layers_sequence_uidx
  on public.employee_attendance_policy_layers (policy_id, workflow_version, level_sequence)
  where status = 'active';

create index if not exists employee_attendance_policy_layers_scope_idx
  on public.employee_attendance_policy_layers (organization_id, company_id, site_id, workflow_version, status);

create index if not exists employee_attendance_policy_layers_approver_idx
  on public.employee_attendance_policy_layers (approver_user_id, status, site_id);

create table if not exists public.employee_attendance_post_lock_editors (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.employee_attendance_policies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  role_code text,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_by_name text,
  assigned_by_email text,
  assigned_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint employee_attendance_post_lock_editor_target_check
    check ((role_code is not null and user_id is null) or (role_code is null and user_id is not null))
);

create unique index if not exists employee_attendance_post_lock_editors_role_uidx
  on public.employee_attendance_post_lock_editors (policy_id, role_code)
  where status = 'active' and role_code is not null;

create unique index if not exists employee_attendance_post_lock_editors_user_uidx
  on public.employee_attendance_post_lock_editors (policy_id, user_id)
  where status = 'active' and user_id is not null;

alter table public.employee_attendance_periods
  add column if not exists approval_workflow_version integer,
  add column if not exists approval_workflow_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists current_approval_level integer,
  add column if not exists corrected_after_lock boolean not null default false;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'employee_attendance_periods_status_check'
      and conrelid = 'public.employee_attendance_periods'::regclass
  ) then
    alter table public.employee_attendance_periods
      drop constraint employee_attendance_periods_status_check;
  end if;
end $$;

alter table public.employee_attendance_periods
  add constraint employee_attendance_periods_status_check
  check (status in ('draft', 'submitted', 'level_1_approved', 'level_2_approved', 'finalized', 'reopened', 'cancelled'));

alter table public.employee_attendance_policy_layers enable row level security;
alter table public.employee_attendance_post_lock_editors enable row level security;

do $$
begin
  grant select, insert, update, delete on table public.employee_attendance_policy_layers to authenticated;
  grant select, insert, update, delete on table public.employee_attendance_post_lock_editors to authenticated;
  grant all on table public.employee_attendance_policy_layers to service_role;
  grant all on table public.employee_attendance_post_lock_editors to service_role;
exception
  when undefined_object then null;
end $$;
