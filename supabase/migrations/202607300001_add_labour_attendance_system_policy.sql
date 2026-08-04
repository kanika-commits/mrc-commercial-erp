alter table public.labour_site_configurations
  add column if not exists attendance_system text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_configurations_attendance_system_check'
      and conrelid = 'public.labour_site_configurations'::regclass
  ) then
    alter table public.labour_site_configurations
      add constraint labour_site_configurations_attendance_system_check
      check (
        attendance_system is null
        or attendance_system in ('standard', 'site_in_engineer')
      );
  end if;
end $$;
