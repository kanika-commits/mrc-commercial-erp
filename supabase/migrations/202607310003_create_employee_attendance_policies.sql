create table if not exists public.employee_attendance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  attendance_method text not null default 'manual_hr_entry',
  approval_workflow_code text not null default 'employee_attendance_period_approval',
  attendance_lock_rule text not null default 'finalized_period',
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint employee_attendance_policies_scope_unique unique (organization_id, company_id, site_id),
  constraint employee_attendance_policies_method_check check (attendance_method in ('manual_hr_entry')),
  constraint employee_attendance_policies_status_check check (status in ('active', 'inactive', 'deleted'))
);

create index if not exists employee_attendance_policies_scope_idx
  on public.employee_attendance_policies (organization_id, company_id, site_id, status);

alter table public.employee_attendance_policies enable row level security;

do $$
begin
  grant select, insert, update, delete on table public.employee_attendance_policies to authenticated;
  grant all on table public.employee_attendance_policies to service_role;
exception
  when undefined_object then null;
end $$;
