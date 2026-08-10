begin;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
values ('hr', 'hr_attendance_register', 'Attendance Register', '/hr/attendance/monthly', 35, 'active')
on conflict (module_code) do update
set module_group = excluded.module_group,
    module_name = excluded.module_name,
    route = excluded.route,
    sort_order = excluded.sort_order,
    status = excluded.status;

insert into public.role_permissions (role_id, module_code, action_code, allowed)
select source.role_id, 'hr_attendance_register', 'view', source.allowed
from public.role_permissions source
where source.module_code = 'hr_attendance'
  and source.action_code = 'view'
  and not exists (
    select 1 from public.role_permissions existing
    where existing.role_id = source.role_id
      and existing.module_code = 'hr_attendance_register'
      and existing.action_code = 'view'
  );

insert into public.user_permissions (user_id, module_code, action_code, allowed)
select source.user_id, 'hr_attendance_register', 'view', source.allowed
from public.user_permissions source
where source.module_code = 'hr_attendance'
  and source.action_code = 'view'
  and not exists (
    select 1 from public.user_permissions existing
    where existing.user_id = source.user_id
      and existing.module_code = 'hr_attendance_register'
      and existing.action_code = 'view'
  );

commit;
