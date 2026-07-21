begin;

create table if not exists public.erp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  company_id uuid,
  site_id uuid,
  module_code text not null,
  entity_type text not null,
  record_id uuid,
  parent_entity_type text,
  parent_record_id uuid,
  action text not null,
  description text,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  browser text,
  device_type text,
  source text not null default 'system',
  import_batch_id text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table public.erp_audit_logs
  add column if not exists organization_id uuid,
  add column if not exists company_id uuid,
  add column if not exists site_id uuid,
  add column if not exists module_code text,
  add column if not exists entity_type text,
  add column if not exists record_id uuid,
  add column if not exists parent_entity_type text,
  add column if not exists parent_record_id uuid,
  add column if not exists action text,
  add column if not exists description text,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists browser text,
  add column if not exists device_type text,
  add column if not exists source text default 'system',
  add column if not exists import_batch_id text,
  add column if not exists created_by uuid,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists created_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'erp_audit_logs_action_check'
      and conrelid = 'public.erp_audit_logs'::regclass
  ) then
    alter table public.erp_audit_logs
      drop constraint erp_audit_logs_action_check;
  end if;

  alter table public.erp_audit_logs
    add constraint erp_audit_logs_action_check
    check (
      action in (
        'create',
        'update',
        'delete',
        'restore',
        'import',
        'export',
        'upload',
        'download',
        'approve',
        'reject',
        'login',
        'logout',
        'password_change',
        'permission_change',
        'salary_revision',
        'employment_change',
        'document_upload',
        'document_replace',
        'document_delete',
        'photo_upload',
        'photo_replace',
        'manual_event',
        'other'
      )
    ) not valid;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'erp_audit_logs_source_check'
      and conrelid = 'public.erp_audit_logs'::regclass
  ) then
    alter table public.erp_audit_logs
      drop constraint erp_audit_logs_source_check;
  end if;

  alter table public.erp_audit_logs
    add constraint erp_audit_logs_source_check
    check (source in ('system', 'manual', 'import', 'api')) not valid;
end $$;

create index if not exists erp_audit_logs_record_idx
  on public.erp_audit_logs (module_code, entity_type, record_id, created_at desc);

create index if not exists erp_audit_logs_parent_record_idx
  on public.erp_audit_logs (module_code, parent_entity_type, parent_record_id, created_at desc);

create index if not exists erp_audit_logs_org_idx
  on public.erp_audit_logs (organization_id, created_at desc);

create index if not exists erp_audit_logs_company_idx
  on public.erp_audit_logs (company_id, created_at desc);

create index if not exists erp_audit_logs_site_idx
  on public.erp_audit_logs (site_id, created_at desc);

create index if not exists erp_audit_logs_action_idx
  on public.erp_audit_logs (action, created_at desc);

create index if not exists erp_audit_logs_user_idx
  on public.erp_audit_logs (created_by, created_at desc);

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
      'hr_audit',
      'HR Audit Trail',
      '/hr/employees',
      40,
      'active'
    where not exists (
      select 1 from public.erp_modules where module_code = 'hr_audit'
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
      'hr_audit',
      'view',
      true
    from public.roles
    where roles.role_code in ('super_admin', 'hr_manager')
      and not exists (
        select 1
        from public.role_permissions existing
        where existing.role_id = roles.id
          and existing.module_code = 'hr_audit'
          and existing.action_code = 'view'
      );
  end if;
end $$;

alter table public.erp_audit_logs enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant all on table public.erp_audit_logs to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant all on table public.erp_audit_logs to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.erp_audit_logs to service_role;
  end if;
end $$;

commit;
