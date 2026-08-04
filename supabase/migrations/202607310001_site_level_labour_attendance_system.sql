-- Site-level Labour attendance system policy.
-- Company remains an employer filter; Site owns the operational attendance system.

alter table public.labour_site_attendance_policies
  add column if not exists attendance_system text,
  add column if not exists changed_reason text;

alter table public.labour_site_attendance_policies
  alter column company_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_attendance_policies_attendance_system_check'
      and conrelid = 'public.labour_site_attendance_policies'::regclass
  ) then
    alter table public.labour_site_attendance_policies
      add constraint labour_site_attendance_policies_attendance_system_check
      check (
        attendance_system is null
        or attendance_system in ('standard', 'site_in_engineer')
      );
  end if;
end $$;

create unique index if not exists labour_site_attendance_system_current_uidx
  on public.labour_site_attendance_policies (organization_id, site_id)
  where company_id is null
    and status = 'active'
    and effective_to is null
    and attendance_system is not null;

create index if not exists labour_site_attendance_system_site_idx
  on public.labour_site_attendance_policies (organization_id, site_id, status, effective_to)
  where company_id is null
    and attendance_system is not null;

insert into public.labour_site_attendance_policies (
  organization_id,
  company_id,
  site_id,
  attendance_system,
  status,
  effective_from,
  changed_reason,
  created_at,
  updated_at
)
select
  grouped.organization_id,
  null,
  grouped.site_id,
  grouped.attendance_system,
  'active',
  current_date,
  'Backfilled from consistent Labour Muster Configuration rows.',
  now(),
  now()
from (
  select
    organization_id,
    site_id,
    min(attendance_system) as attendance_system
  from public.labour_site_configurations
  where status = 'active'
    and attendance_system in ('standard', 'site_in_engineer')
  group by organization_id, site_id
  having count(distinct attendance_system) = 1
) grouped
where not exists (
  select 1
  from public.labour_site_attendance_policies existing
  where existing.organization_id = grouped.organization_id
    and existing.site_id = grouped.site_id
    and existing.company_id is null
    and existing.status = 'active'
    and existing.effective_to is null
    and existing.attendance_system is not null
);
