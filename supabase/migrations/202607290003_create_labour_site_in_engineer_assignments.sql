create table if not exists public.labour_site_in_engineer_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  site_in_date date not null,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id),
  labour_worker_id uuid not null references public.labour_workers(id),
  deployment_id uuid not null references public.labour_deployments(id),
  site_in_id uuid not null references public.labour_site_ins(id),
  engineer_employee_id uuid not null references public.hr_employees(id),
  engineer_user_id uuid references public.profiles(id),
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

create unique index if not exists labour_site_in_engineer_assignments_worker_uidx
  on public.labour_site_in_engineer_assignments (organization_id, company_id, site_id, site_in_date, labour_worker_id)
  where status = 'active';

create index if not exists labour_site_in_engineer_assignments_engineer_idx
  on public.labour_site_in_engineer_assignments (engineer_employee_id, site_in_date desc, status);

create index if not exists labour_site_in_engineer_assignments_scope_idx
  on public.labour_site_in_engineer_assignments (organization_id, company_id, site_id, site_in_date, contractor_profile_id, status);

alter table public.labour_site_in_engineer_assignments enable row level security;

grant all on public.labour_site_in_engineer_assignments to service_role;
