-- Labour Attendance Import V1.
-- Safe to run in Supabase SQL Editor; idempotent and non-destructive.

begin;

create extension if not exists pgcrypto;

create table if not exists public.labour_attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  selected_company_id uuid references public.companies(id),
  selected_site_id uuid references public.sites(id),
  selected_contractor_profile_id uuid references public.labour_contractor_profiles(id),
  selected_period_month date,
  import_format text not null check (import_format in ('monthly_muster', 'transaction')),
  source_file_name text not null,
  source_file_hash text,
  source_file_size bigint,
  source_sheet_name text,
  status text not null default 'uploaded' check (status in ('uploaded', 'validated', 'executed', 'failed', 'cancelled')),
  mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_by uuid,
  executed_by_name text,
  executed_by_email text,
  executed_at timestamptz
);

create table if not exists public.labour_attendance_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.labour_attendance_import_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_row_number integer not null,
  source_column text,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  labour_code text,
  worker_name text,
  attendance_date date,
  attendance_code text,
  matched_labour_worker_id uuid references public.labour_workers(id) on delete set null,
  matched_deployment_id uuid references public.labour_deployments(id) on delete set null,
  matched_company_id uuid references public.companies(id) on delete set null,
  matched_site_id uuid references public.sites(id) on delete set null,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'ready', 'warning', 'blocked', 'executed', 'failed')),
  validation_errors text[] not null default '{}'::text[],
  validation_warnings text[] not null default '{}'::text[],
  selected_action text not null default 'import' check (selected_action in ('import', 'skip')),
  execution_status text not null default 'pending' check (execution_status in ('pending', 'executed', 'failed', 'skipped')),
  imported_attendance_id uuid references public.labour_attendance(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.labour_attendance
  add column if not exists import_batch_id uuid null references public.labour_attendance_import_batches(id) on delete set null,
  add column if not exists import_row_id uuid null references public.labour_attendance_import_rows(id) on delete set null;

create index if not exists labour_attendance_import_batches_org_idx
  on public.labour_attendance_import_batches (organization_id, created_at desc);

create index if not exists labour_attendance_import_rows_batch_idx
  on public.labour_attendance_import_rows (batch_id, validation_status, execution_status);

create unique index if not exists labour_attendance_import_rows_source_uidx
  on public.labour_attendance_import_rows (batch_id, source_row_number, (coalesce(source_column, '')));

create index if not exists labour_attendance_import_rows_worker_date_idx
  on public.labour_attendance_import_rows (matched_labour_worker_id, attendance_date);

alter table public.labour_attendance_import_batches enable row level security;
alter table public.labour_attendance_import_rows enable row level security;

grant all on public.labour_attendance_import_batches to service_role;
grant all on public.labour_attendance_import_rows to service_role;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values
  ('labour_attendance_import', 'Labour Attendance Import', 'labour_management', '/labour/attendance/import', 'active', 6)
on conflict (module_code) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route = excluded.route,
  status = excluded.status,
  sort_order = excluded.sort_order;

with modules(module_code, action_code) as (
  values
    ('labour_attendance_import','view'),
    ('labour_attendance_import','upload'),
    ('labour_attendance_import','execute'),
    ('labour_attendance_import','export')
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
