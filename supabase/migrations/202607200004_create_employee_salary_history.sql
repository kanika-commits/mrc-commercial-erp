begin;

create table if not exists public.employee_salary_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  revision_no integer not null default 1,
  revision_type text not null,
  effective_from date not null,
  effective_to date,
  basic_salary numeric(14,2),
  gross_salary numeric(14,2),
  net_salary numeric(14,2),
  ctc numeric(14,2),
  employee_pf numeric(14,2),
  employer_pf numeric(14,2),
  employee_esic numeric(14,2),
  employer_esic numeric(14,2),
  professional_tax numeric(14,2),
  tds numeric(14,2),
  other_salary_deductions numeric(14,2),
  bonus numeric(14,2),
  reason text,
  remarks text,
  source text not null default 'manual',
  source_system text,
  source_record_id text,
  import_batch_id text,
  status text not null default 'current',
  previous_values jsonb,
  new_values jsonb,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz
);

alter table public.employee_salary_history
  add column if not exists organization_id uuid,
  add column if not exists employee_id uuid,
  add column if not exists revision_no integer default 1,
  add column if not exists revision_type text,
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists basic_salary numeric(14,2),
  add column if not exists gross_salary numeric(14,2),
  add column if not exists net_salary numeric(14,2),
  add column if not exists ctc numeric(14,2),
  add column if not exists employee_pf numeric(14,2),
  add column if not exists employer_pf numeric(14,2),
  add column if not exists employee_esic numeric(14,2),
  add column if not exists employer_esic numeric(14,2),
  add column if not exists professional_tax numeric(14,2),
  add column if not exists tds numeric(14,2),
  add column if not exists other_salary_deductions numeric(14,2),
  add column if not exists bonus numeric(14,2),
  add column if not exists reason text,
  add column if not exists remarks text,
  add column if not exists source text default 'manual',
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists import_batch_id text,
  add column if not exists status text default 'current',
  add column if not exists previous_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists created_by uuid,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_by uuid,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_salary_history_employee_id_fkey'
      and conrelid = 'public.employee_salary_history'::regclass
  ) then
    alter table public.employee_salary_history
      add constraint employee_salary_history_employee_id_fkey
      foreign key (employee_id) references public.hr_employees(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employee_salary_history_revision_type_check'
      and conrelid = 'public.employee_salary_history'::regclass
  ) then
    alter table public.employee_salary_history
      drop constraint employee_salary_history_revision_type_check;
  end if;

  alter table public.employee_salary_history
    add constraint employee_salary_history_revision_type_check
    check (
      revision_type in (
        'joining_salary',
        'annual_increment',
        'promotion_revision',
        'salary_correction',
        'special_revision',
        'retention_revision',
        'market_adjustment',
        'other'
      )
    ) not valid;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employee_salary_history_status_check'
      and conrelid = 'public.employee_salary_history'::regclass
  ) then
    alter table public.employee_salary_history
      drop constraint employee_salary_history_status_check;
  end if;

  alter table public.employee_salary_history
    add constraint employee_salary_history_status_check
    check (status in ('current', 'historical', 'draft')) not valid;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employee_salary_history_source_check'
      and conrelid = 'public.employee_salary_history'::regclass
  ) then
    alter table public.employee_salary_history
      drop constraint employee_salary_history_source_check;
  end if;

  alter table public.employee_salary_history
    add constraint employee_salary_history_source_check
    check (source in ('manual', 'system', 'import')) not valid;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_salary_history_effective_dates_check'
      and conrelid = 'public.employee_salary_history'::regclass
  ) then
    alter table public.employee_salary_history
      add constraint employee_salary_history_effective_dates_check
      check (effective_to is null or effective_to >= effective_from) not valid;
  end if;
end $$;

create unique index if not exists employee_salary_history_current_once_idx
  on public.employee_salary_history (employee_id)
  where status = 'current';

create unique index if not exists employee_salary_history_revision_no_idx
  on public.employee_salary_history (employee_id, revision_no);

create unique index if not exists employee_salary_history_import_reference_idx
  on public.employee_salary_history (organization_id, source_system, source_record_id)
  where source = 'import' and source_system is not null and source_record_id is not null;

create index if not exists employee_salary_history_employee_date_idx
  on public.employee_salary_history (employee_id, effective_from desc, created_at desc);

create index if not exists employee_salary_history_organization_date_idx
  on public.employee_salary_history (organization_id, effective_from desc, created_at desc);

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
      'hr_salary',
      'Salary History',
      '/hr/employees',
      30,
      'active'
    where not exists (
      select 1 from public.erp_modules where module_code = 'hr_salary'
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
      module_actions.module_code,
      module_actions.action_code,
      true
    from public.roles
    cross join (
      values
        ('hr_salary', 'view'),
        ('hr_salary', 'add'),
        ('hr_salary', 'edit'),
        ('hr_salary', 'delete')
    ) as module_actions(module_code, action_code)
    where roles.role_code = 'super_admin'
      and not exists (
        select 1
        from public.role_permissions existing
        where existing.role_id = roles.id
          and existing.module_code = module_actions.module_code
          and existing.action_code = module_actions.action_code
      );
  end if;
end $$;

alter table public.employee_salary_history enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant all on table public.employee_salary_history to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant all on table public.employee_salary_history to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.employee_salary_history to service_role;
  end if;
end $$;

commit;
