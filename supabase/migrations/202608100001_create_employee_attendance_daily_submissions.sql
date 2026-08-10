begin;

create table if not exists public.employee_attendance_daily_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  period_id uuid not null references public.employee_attendance_periods(id) on delete restrict,
  attendance_date date not null,
  status text not null default 'draft',
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  reopened_by_name text,
  reopened_by_email text,
  reopened_at timestamptz,
  reopen_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint employee_attendance_daily_submissions_status_check
    check (status in ('draft', 'submitted', 'approved', 'reopened', 'cancelled')),
  constraint employee_attendance_daily_submissions_scope_date_unique
    unique (organization_id, company_id, site_id, attendance_date)
);

create index if not exists employee_attendance_daily_submissions_site_date_idx
  on public.employee_attendance_daily_submissions (organization_id, site_id, attendance_date);
create index if not exists employee_attendance_daily_submissions_company_date_idx
  on public.employee_attendance_daily_submissions (organization_id, company_id, attendance_date);
create index if not exists employee_attendance_daily_submissions_period_idx
  on public.employee_attendance_daily_submissions (period_id);
create index if not exists employee_attendance_daily_submissions_status_idx
  on public.employee_attendance_daily_submissions (status, attendance_date);

alter table public.employee_attendance_daily_submissions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on table public.employee_attendance_daily_submissions to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.employee_attendance_daily_submissions to service_role;
  end if;
end $$;

commit;
