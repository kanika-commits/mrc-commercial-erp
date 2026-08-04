create table if not exists public.labour_site_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  site_hr_user_id uuid references public.profiles(id),
  pm_user_id uuid references public.profiles(id),
  attendance_lock_hours integer not null default 5 check (attendance_lock_hours >= 1 and attendance_lock_hours <= 168),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint labour_site_configurations_unique_scope unique (organization_id, company_id, site_id)
);

create table if not exists public.labour_site_override_authorities (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid references public.labour_site_configurations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  assigned_by uuid,
  assigned_by_name text,
  assigned_by_email text,
  assigned_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create index if not exists labour_site_configurations_scope_idx
  on public.labour_site_configurations (organization_id, company_id, site_id, status);

create index if not exists labour_site_configurations_pm_idx
  on public.labour_site_configurations (pm_user_id, status, site_id);

create index if not exists labour_site_configurations_site_hr_idx
  on public.labour_site_configurations (site_hr_user_id, status, site_id);

create index if not exists labour_site_override_authorities_scope_idx
  on public.labour_site_override_authorities (organization_id, company_id, site_id, status);

create unique index if not exists labour_site_override_authorities_active_uidx
  on public.labour_site_override_authorities (organization_id, company_id, site_id, user_id)
  where status = 'active';

create index if not exists labour_site_override_authorities_user_idx
  on public.labour_site_override_authorities (user_id, status, site_id);

alter table public.labour_site_configurations enable row level security;
alter table public.labour_site_override_authorities enable row level security;

grant all on public.labour_site_configurations to service_role;
grant all on public.labour_site_override_authorities to service_role;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values ('labour_muster_configuration', 'Muster Configuration', 'hr', '/labour/configuration', 'active', 4.75)
on conflict (module_code) do update
set module_name = excluded.module_name,
    module_group = excluded.module_group,
    route = excluded.route,
    status = excluded.status,
    sort_order = excluded.sort_order;

with configuration_permissions(module_code, action_code) as (
  values
    ('labour_muster_configuration', 'view'),
    ('labour_muster_configuration', 'edit_site_responsibility'),
    ('labour_muster_configuration', 'edit_attendance_policy'),
    ('labour_muster_configuration', 'assign_override_authority'),
    ('labour_muster_configuration', 'export'),
    ('labour_attendance_policy', 'override')
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
    ('labour_muster_configuration', 'export'),
    ('labour_attendance_policy', 'override')
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
