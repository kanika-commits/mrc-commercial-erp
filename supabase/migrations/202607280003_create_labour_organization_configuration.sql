create table if not exists public.labour_organization_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  ho_hr_employee_id uuid references public.hr_employees(id),
  ho_hr_user_id uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint labour_organization_configurations_unique_org unique (organization_id)
);

create index if not exists labour_organization_configurations_org_idx
  on public.labour_organization_configurations (organization_id, status);

create index if not exists labour_organization_configurations_ho_hr_idx
  on public.labour_organization_configurations (ho_hr_user_id, status, organization_id);

alter table public.labour_organization_configurations enable row level security;

grant all on public.labour_organization_configurations to service_role;
