-- Allow any safe non-negative whole-number attendance lock duration.
-- Apply manually; this migration does not modify existing configuration data.
begin;

alter table public.labour_site_configurations
  drop constraint if exists labour_site_configurations_attendance_lock_hours_check;

alter table public.labour_site_configurations
  add constraint labour_site_configurations_attendance_lock_hours_check
  check (attendance_lock_hours >= 0);

commit;
