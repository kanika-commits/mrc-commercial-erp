begin;

create table if not exists public.employee_employment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  event_type text not null,
  event_date date not null,
  effective_from date,
  effective_to date,
  title text,
  description text,
  reason text,
  source text not null default 'system',
  is_manual boolean not null default false,
  previous_values jsonb,
  new_values jsonb,
  company_id uuid,
  site_id uuid,
  department_id uuid,
  designation_id uuid,
  reporting_manager_id uuid,
  employment_type text,
  shift text,
  employment_status text,
  reference_document_id uuid,
  source_system text,
  source_record_id text,
  import_batch_id text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz
);

alter table public.employee_employment_history
  add column if not exists organization_id uuid,
  add column if not exists employee_id uuid,
  add column if not exists event_type text,
  add column if not exists event_date date,
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists reason text,
  add column if not exists source text default 'system',
  add column if not exists is_manual boolean default false,
  add column if not exists previous_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists company_id uuid,
  add column if not exists site_id uuid,
  add column if not exists department_id uuid,
  add column if not exists designation_id uuid,
  add column if not exists reporting_manager_id uuid,
  add column if not exists employment_type text,
  add column if not exists shift text,
  add column if not exists employment_status text,
  add column if not exists reference_document_id uuid,
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists import_batch_id text,
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
    where conname = 'employee_employment_history_employee_id_fkey'
      and conrelid = 'public.employee_employment_history'::regclass
  ) then
    alter table public.employee_employment_history
      add constraint employee_employment_history_employee_id_fkey
      foreign key (employee_id) references public.hr_employees(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employee_employment_history_event_type_check'
      and conrelid = 'public.employee_employment_history'::regclass
  ) then
    alter table public.employee_employment_history
      drop constraint employee_employment_history_event_type_check;
  end if;

  alter table public.employee_employment_history
    add constraint employee_employment_history_event_type_check
    check (
      event_type in (
        'joined',
        'confirmed',
        'company_changed',
        'site_changed',
        'department_changed',
        'designation_changed',
        'reporting_manager_changed',
        'employee_type_changed',
        'shift_changed',
        'status_changed',
        'promoted',
        'transferred',
        'suspended',
        'reinstated',
        'resigned',
        'relieved',
        'rejoined',
        'correction',
        'other'
      )
    ) not valid;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employee_employment_history_source_check'
      and conrelid = 'public.employee_employment_history'::regclass
  ) then
    alter table public.employee_employment_history
      drop constraint employee_employment_history_source_check;
  end if;

  alter table public.employee_employment_history
    add constraint employee_employment_history_source_check
    check (source in ('system', 'manual', 'import')) not valid;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_employment_history_effective_dates_check'
      and conrelid = 'public.employee_employment_history'::regclass
  ) then
    alter table public.employee_employment_history
      add constraint employee_employment_history_effective_dates_check
      check (effective_to is null or effective_from is null or effective_to >= effective_from) not valid;
  end if;
end $$;

create index if not exists employee_employment_history_employee_date_idx
  on public.employee_employment_history (employee_id, event_date desc, created_at desc);

create index if not exists employee_employment_history_organization_date_idx
  on public.employee_employment_history (organization_id, event_date desc, created_at desc);

create index if not exists employee_employment_history_event_type_idx
  on public.employee_employment_history (event_type);

create unique index if not exists employee_employment_history_joined_once_idx
  on public.employee_employment_history (employee_id)
  where event_type = 'joined' and source = 'system';

create unique index if not exists employee_employment_history_import_reference_idx
  on public.employee_employment_history (organization_id, source_system, source_record_id)
  where source = 'import' and source_system is not null and source_record_id is not null;

insert into public.employee_employment_history (
  organization_id,
  employee_id,
  event_type,
  event_date,
  effective_from,
  title,
  description,
  source,
  is_manual,
  new_values,
  company_id,
  site_id,
  department_id,
  designation_id,
  reporting_manager_id,
  employment_type,
  shift,
  employment_status,
  created_by,
  created_by_name,
  created_by_email,
  created_at
)
select
  e.organization_id,
  e.id,
  'joined',
  coalesce(
    nullif(to_jsonb(e)->>'date_of_joining', '')::date,
    nullif(to_jsonb(e)->>'created_at', '')::timestamptz::date,
    current_date
  ),
  nullif(to_jsonb(e)->>'date_of_joining', '')::date,
  'Joined',
  'Initial employment snapshot created when Employment Timeline was enabled.',
  'system',
  false,
  jsonb_build_object(
    'company_id', nullif(to_jsonb(e)->>'company_id', ''),
    'site_id', nullif(to_jsonb(e)->>'site_id', ''),
    'department_id', nullif(to_jsonb(e)->>'department_id', ''),
    'designation_id', nullif(to_jsonb(e)->>'designation_id', ''),
    'reporting_manager_id', nullif(to_jsonb(e)->>'reporting_manager_id', ''),
    'employment_type', nullif(to_jsonb(e)->>'employment_type', ''),
    'shift', nullif(to_jsonb(e)->>'shift', ''),
    'status', nullif(to_jsonb(e)->>'status', ''),
    'date_of_joining', nullif(to_jsonb(e)->>'date_of_joining', '')
  ),
  nullif(to_jsonb(e)->>'company_id', '')::uuid,
  nullif(to_jsonb(e)->>'site_id', '')::uuid,
  nullif(to_jsonb(e)->>'department_id', '')::uuid,
  nullif(to_jsonb(e)->>'designation_id', '')::uuid,
  nullif(to_jsonb(e)->>'reporting_manager_id', '')::uuid,
  nullif(to_jsonb(e)->>'employment_type', ''),
  nullif(to_jsonb(e)->>'shift', ''),
  nullif(to_jsonb(e)->>'status', ''),
  nullif(to_jsonb(e)->>'created_by', '')::uuid,
  nullif(to_jsonb(e)->>'created_by_name', ''),
  nullif(to_jsonb(e)->>'created_by_email', ''),
  coalesce(nullif(to_jsonb(e)->>'created_at', '')::timestamptz, now())
from public.hr_employees e
where coalesce(to_jsonb(e)->>'status', '') <> 'deleted'
  and not exists (
    select 1
    from public.employee_employment_history h
    where h.employee_id = e.id
      and h.event_type = 'joined'
      and h.source = 'system'
  );

alter table public.employee_employment_history enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant all on table public.employee_employment_history to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant all on table public.employee_employment_history to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.employee_employment_history to service_role;
  end if;
end $$;

commit;
