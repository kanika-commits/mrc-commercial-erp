-- Store the immutable Labour attendance workflow that created each operational parent.
-- New work continues to use the current Site policy; existing work keeps this stored value.

alter table public.labour_attendance_periods
  add column if not exists originating_attendance_system text;

alter table public.labour_site_ins
  add column if not exists originating_attendance_system text;

alter table public.labour_daily_submissions
  add column if not exists originating_attendance_system text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_attendance_periods_originating_system_check'
      and conrelid = 'public.labour_attendance_periods'::regclass
  ) then
    alter table public.labour_attendance_periods
      add constraint labour_attendance_periods_originating_system_check
      check (
        originating_attendance_system is null
        or originating_attendance_system in ('standard', 'site_in_engineer')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_ins_originating_system_check'
      and conrelid = 'public.labour_site_ins'::regclass
  ) then
    alter table public.labour_site_ins
      add constraint labour_site_ins_originating_system_check
      check (
        originating_attendance_system is null
        or originating_attendance_system in ('site_in_engineer')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_daily_submissions_originating_system_check'
      and conrelid = 'public.labour_daily_submissions'::regclass
  ) then
    alter table public.labour_daily_submissions
      add constraint labour_daily_submissions_originating_system_check
      check (
        originating_attendance_system is null
        or originating_attendance_system in ('site_in_engineer')
      );
  end if;
end $$;

update public.labour_site_ins
set originating_attendance_system = 'site_in_engineer'
where originating_attendance_system is null;

update public.labour_daily_submissions
set originating_attendance_system = 'site_in_engineer'
where originating_attendance_system is null;

update public.labour_attendance_periods p
set originating_attendance_system = 'site_in_engineer'
where p.originating_attendance_system is null
  and exists (
    select 1
    from public.labour_attendance a
    where a.period_id = p.id
      and a.site_in_id is not null
  );

update public.labour_attendance_periods p
set originating_attendance_system = 'standard'
where p.originating_attendance_system is null
  and exists (
    select 1
    from public.labour_attendance a
    where a.period_id = p.id
      and a.site_in_id is null
  )
  and not exists (
    select 1
    from public.labour_attendance a
    where a.period_id = p.id
      and a.site_in_id is not null
  );

create index if not exists labour_attendance_periods_originating_system_idx
  on public.labour_attendance_periods (originating_attendance_system, organization_id, site_id, period_month, status);

create index if not exists labour_site_ins_originating_system_idx
  on public.labour_site_ins (originating_attendance_system, organization_id, site_id, site_in_date, status);

create index if not exists labour_daily_submissions_originating_system_idx
  on public.labour_daily_submissions (originating_attendance_system, organization_id, site_id, work_date, status);
