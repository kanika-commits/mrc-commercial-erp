-- Labour Site-In Phase 1.
-- Non-destructive: adds the Site-In table, module metadata and Super Admin permission seeds.

begin;

create table if not exists public.labour_site_ins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id) on delete restrict,
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  deployment_id uuid not null references public.labour_deployments(id) on delete restrict,
  site_in_date date not null,
  site_in_time time not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  marked_by uuid,
  marked_by_name text,
  marked_by_email text,
  marked_at timestamptz not null default now(),
  corrected_from_time time,
  corrected_to_time time,
  correction_reason text,
  corrected_by uuid,
  corrected_by_name text,
  corrected_by_email text,
  corrected_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists labour_site_ins_worker_date_active_uidx
  on public.labour_site_ins (labour_worker_id, site_in_date)
  where status = 'active';

create index if not exists labour_site_ins_scope_date_idx
  on public.labour_site_ins (organization_id, company_id, site_id, site_in_date, status);

create index if not exists labour_site_ins_contractor_date_idx
  on public.labour_site_ins (organization_id, company_id, site_id, contractor_profile_id, site_in_date, status);

create index if not exists labour_site_ins_deployment_idx
  on public.labour_site_ins (deployment_id, site_in_date, status);

alter table public.labour_site_ins enable row level security;

grant all on public.labour_site_ins to service_role;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values
  ('labour_site_in', 'Site-In', 'labour_management', '/labour/site-in', 'active', 3.5)
on conflict (module_code) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route = excluded.route,
  status = excluded.status,
  sort_order = excluded.sort_order;

with modules(module_code, action_code) as (
  values
    ('labour_site_in', 'view'),
    ('labour_site_in', 'add'),
    ('labour_site_in', 'correct_time')
),
super_admin_roles as (
  select id from public.roles where lower(role_code) = 'super_admin'
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, m.module_code, m.action_code, true
from super_admin_roles r
cross join modules m
where not exists (
  select 1 from public.role_permissions rp
  where rp.role_id = r.id and rp.module_code = m.module_code and rp.action_code = m.action_code
);

commit;
