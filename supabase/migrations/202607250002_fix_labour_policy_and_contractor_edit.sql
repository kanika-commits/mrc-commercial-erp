-- Labour Management corrective migration after V2 was applied.
-- Adds hour-based automatic attendance locking without removing legacy auto_lock_time.

alter table public.labour_site_attendance_policies
  add column if not exists auto_lock_basis text,
  add column if not exists auto_lock_delay_hours integer;

update public.labour_site_attendance_policies
set
  auto_lock_basis = coalesce(auto_lock_basis, 'after_shift_end'),
  auto_lock_delay_hours = coalesce(auto_lock_delay_hours, 4)
where status = 'active'
  and effective_to is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_attendance_policies_auto_lock_basis_check'
      and conrelid = 'public.labour_site_attendance_policies'::regclass
  ) then
    alter table public.labour_site_attendance_policies
      add constraint labour_site_attendance_policies_auto_lock_basis_check
      check (auto_lock_basis is null or auto_lock_basis in ('after_shift_end'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_site_attendance_policies_auto_lock_delay_hours_check'
      and conrelid = 'public.labour_site_attendance_policies'::regclass
  ) then
    alter table public.labour_site_attendance_policies
      add constraint labour_site_attendance_policies_auto_lock_delay_hours_check
      check (auto_lock_delay_hours is null or (auto_lock_delay_hours >= 0 and auto_lock_delay_hours <= 168));
  end if;
end $$;
