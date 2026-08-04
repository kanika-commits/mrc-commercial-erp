-- Site-wise Labour Muster workflow configuration foundation.
-- Phase 1 only: stores configurable approval layers, configuration audit, and
-- future workflow snapshots without changing current approval transitions.

alter table public.labour_site_configurations
  add column if not exists approval_layer_count integer not null default 2,
  add column if not exists approval_workflow_version integer not null default 1,
  add column if not exists post_lock_correction_enabled boolean not null default true;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_configurations_attendance_lock_hours_check'
      and conrelid = 'public.labour_site_configurations'::regclass
  ) then
    alter table public.labour_site_configurations
      drop constraint labour_site_configurations_attendance_lock_hours_check;
  end if;
end $$;

alter table public.labour_site_configurations
  add constraint labour_site_configurations_attendance_lock_hours_check
  check (attendance_lock_hours >= 0 and attendance_lock_hours <= 168);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_configurations_approval_layer_count_check'
      and conrelid = 'public.labour_site_configurations'::regclass
  ) then
    alter table public.labour_site_configurations
      add constraint labour_site_configurations_approval_layer_count_check
      check (approval_layer_count between 1 and 5);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_configurations_approval_workflow_version_check'
      and conrelid = 'public.labour_site_configurations'::regclass
  ) then
    alter table public.labour_site_configurations
      add constraint labour_site_configurations_approval_workflow_version_check
      check (approval_workflow_version >= 1);
  end if;
end $$;

create table if not exists public.labour_site_approval_layers (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.labour_site_configurations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  workflow_version integer not null check (workflow_version >= 1),
  layer_sequence integer not null check (layer_sequence between 1 and 5),
  stage_name text not null,
  approver_user_id uuid not null references public.profiles(id),
  approver_employee_id uuid references public.hr_employees(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create unique index if not exists labour_site_approval_layers_sequence_uidx
  on public.labour_site_approval_layers (configuration_id, workflow_version, layer_sequence)
  where status = 'active';

create index if not exists labour_site_approval_layers_scope_idx
  on public.labour_site_approval_layers (organization_id, company_id, site_id, workflow_version, status);

create index if not exists labour_site_approval_layers_approver_idx
  on public.labour_site_approval_layers (approver_user_id, status, site_id);

create table if not exists public.labour_site_configuration_events (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid references public.labour_site_configurations(id) on delete set null,
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  event_type text not null,
  previous_values jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists labour_site_configuration_events_scope_idx
  on public.labour_site_configuration_events (organization_id, company_id, site_id, created_at desc);

alter table public.labour_daily_submissions
  add column if not exists approval_workflow_version integer,
  add column if not exists approval_workflow_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists current_approval_layer integer,
  add column if not exists corrected_after_lock boolean not null default false;

alter table public.labour_attendance_periods
  add column if not exists approval_workflow_version integer,
  add column if not exists approval_workflow_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists current_approval_layer integer,
  add column if not exists corrected_after_lock boolean not null default false;

alter table public.labour_site_approval_layers enable row level security;
alter table public.labour_site_configuration_events enable row level security;

grant all on public.labour_site_approval_layers to service_role;
grant all on public.labour_site_configuration_events to service_role;

with configuration_permissions(module_code, action_code) as (
  values
    ('labour_muster_configuration', 'view'),
    ('labour_muster_configuration', 'edit_site_responsibility'),
    ('labour_muster_configuration', 'edit_attendance_policy'),
    ('labour_muster_configuration', 'assign_override_authority'),
    ('labour_muster_configuration', 'export')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
update public.role_permissions rp
set allowed = true
from system_roles r
cross join configuration_permissions p
where rp.role_id = r.id
  and rp.module_code = p.module_code
  and rp.action_code = p.action_code;

with configuration_permissions(module_code, action_code) as (
  values
    ('labour_muster_configuration', 'view'),
    ('labour_muster_configuration', 'edit_site_responsibility'),
    ('labour_muster_configuration', 'edit_attendance_policy'),
    ('labour_muster_configuration', 'assign_override_authority'),
    ('labour_muster_configuration', 'export')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from system_roles r
cross join configuration_permissions p
where not exists (
  select 1
  from public.role_permissions rp
  where rp.role_id = r.id
    and rp.module_code = p.module_code
    and rp.action_code = p.action_code
);
