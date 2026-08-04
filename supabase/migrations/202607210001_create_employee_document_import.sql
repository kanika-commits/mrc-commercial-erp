begin;

do $$
begin
  if to_regclass('public.erp_modules') is not null then
    insert into public.erp_modules (
      module_group,
      module_code,
      module_name,
      route,
      sort_order,
      status
    )
    select
      'hr',
      'hr_employee_document_import',
      'Employee Document Import',
      '/hr/employees/import-documents',
      36,
      'active'
    where not exists (
      select 1 from public.erp_modules where module_code = 'hr_employee_document_import'
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.roles') is not null and to_regclass('public.role_permissions') is not null then
    insert into public.role_permissions (
      role_id,
      module_code,
      action_code,
      allowed
    )
    select
      roles.id,
      'hr_employee_document_import',
      action_codes.action_code,
      true
    from public.roles
    cross join (
      values ('view'), ('upload'), ('execute'), ('export')
    ) as action_codes(action_code)
    where roles.role_code in ('super_admin')
      and not exists (
        select 1
        from public.role_permissions existing
        where existing.role_id = roles.id
          and existing.module_code = 'hr_employee_document_import'
          and existing.action_code = action_codes.action_code
      );
  end if;
end $$;

create table if not exists public.employee_document_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  original_file_name text not null,
  source_file_size bigint null,
  source_file_hash text null,
  sheet_name text null,
  status text not null default 'uploaded',
  mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  notes text null,
  created_by uuid null,
  created_by_name text null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_by uuid null,
  updated_by_name text null,
  updated_by_email text null,
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint employee_document_import_batches_status_check
    check (status in ('uploaded', 'validated', 'ready', 'executing', 'completed', 'completed_with_errors', 'failed', 'cancelled'))
);

create table if not exists public.employee_document_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.employee_document_import_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_sheet_name text null,
  source_row_number integer not null,
  employee_code text null,
  employee_name text null,
  source_site text null,
  matched_employee_id uuid null references public.hr_employees(id) on delete set null,
  source_column text not null,
  source_cell_value text null,
  source_drive_url text not null,
  drive_file_id text null,
  document_type text not null,
  document_metadata jsonb not null default '{}'::jsonb,
  selected_action text not null default 'pending',
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  validation_warnings jsonb not null default '[]'::jsonb,
  execution_status text not null default 'pending',
  execution_error text null,
  source_file_name text null,
  source_mime_type text null,
  source_size_bytes bigint null,
  created_employee_document_id uuid null references public.employee_documents(id) on delete set null,
  executed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_document_import_rows_validation_status_check
    check (validation_status in ('pending', 'ready', 'warning', 'invalid')),
  constraint employee_document_import_rows_execution_status_check
    check (execution_status in ('pending', 'imported', 'skipped', 'failed')),
  constraint employee_document_import_rows_selected_action_check
    check (selected_action in ('pending', 'skip', 'new_version'))
);

create index if not exists idx_employee_document_import_batches_org_created
  on public.employee_document_import_batches (organization_id, created_at desc);

create index if not exists idx_employee_document_import_batches_site
  on public.employee_document_import_batches (site_id, created_at desc);

create index if not exists idx_employee_document_import_rows_batch
  on public.employee_document_import_rows (batch_id, source_row_number);

create index if not exists idx_employee_document_import_rows_execution
  on public.employee_document_import_rows (batch_id, execution_status, validation_status);

create index if not exists idx_employee_document_import_rows_employee
  on public.employee_document_import_rows (matched_employee_id);

create index if not exists idx_employee_document_import_rows_drive_file
  on public.employee_document_import_rows (drive_file_id);

create unique index if not exists uniq_employee_document_import_rows_batch_url_column
  on public.employee_document_import_rows (batch_id, source_row_number, source_column, source_drive_url);

alter table public.employee_document_import_batches enable row level security;
alter table public.employee_document_import_rows enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on table public.employee_document_import_batches to authenticated;
    grant select, insert, update, delete on table public.employee_document_import_rows to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.employee_document_import_batches to service_role;
    grant select, insert, update, delete on table public.employee_document_import_rows to service_role;
  end if;
end $$;

commit;
