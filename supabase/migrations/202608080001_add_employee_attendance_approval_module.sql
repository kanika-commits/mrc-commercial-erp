begin;

insert into public.erp_modules (
  module_group,
  module_code,
  module_name,
  route,
  sort_order,
  status
)
values (
  'hr',
  'hr_attendance_approval',
  'Attendance Approval',
  '/hr/attendance-approval',
  40,
  'active'
)
on conflict (module_code) do update
set
  module_group = excluded.module_group,
  module_name = excluded.module_name,
  route = excluded.route,
  sort_order = excluded.sort_order,
  status = excluded.status;

commit;
