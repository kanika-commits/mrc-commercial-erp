begin;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
select module_group, module_code, module_name, route, sort_order, status
from (
  values
    ('settings', 'hr_departments', 'Departments', '/hr/departments', 42, 'active'),
    ('settings', 'hr_designations', 'Designations', '/hr/designations', 44, 'active'),
    ('settings', 'hr_employee_attendance_policy', 'Employee Attendance Policy', '/settings/policies/employee-attendance', 82, 'active')
) as modules(module_group, module_code, module_name, route, sort_order, status)
where not exists (
  select 1
  from public.erp_modules existing
  where existing.module_code = modules.module_code
);

with permission_map(old_module_code, new_module_code, action_code) as (
  values
    ('hr_employees', 'hr_departments', 'view'),
    ('hr_employees', 'hr_departments', 'add'),
    ('hr_employees', 'hr_departments', 'edit'),
    ('hr_employees', 'hr_departments', 'delete'),
    ('hr_employees', 'hr_designations', 'view'),
    ('hr_employees', 'hr_designations', 'add'),
    ('hr_employees', 'hr_designations', 'edit'),
    ('hr_employees', 'hr_designations', 'delete'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'view'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'add'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'edit')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select source.role_id, permission_map.new_module_code, source.action_code, source.allowed
from public.role_permissions source
join permission_map
  on permission_map.old_module_code = source.module_code
 and permission_map.action_code = source.action_code
where not exists (
  select 1
  from public.role_permissions existing
  where existing.role_id = source.role_id
    and existing.module_code = permission_map.new_module_code
    and existing.action_code = source.action_code
);

with permission_map(old_module_code, new_module_code, action_code) as (
  values
    ('hr_employees', 'hr_departments', 'view'),
    ('hr_employees', 'hr_departments', 'add'),
    ('hr_employees', 'hr_departments', 'edit'),
    ('hr_employees', 'hr_departments', 'delete'),
    ('hr_employees', 'hr_designations', 'view'),
    ('hr_employees', 'hr_designations', 'add'),
    ('hr_employees', 'hr_designations', 'edit'),
    ('hr_employees', 'hr_designations', 'delete'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'view'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'add'),
    ('hr_attendance', 'hr_employee_attendance_policy', 'edit')
)
insert into public.user_permissions (user_id, module_code, action_code, allowed)
select source.user_id, permission_map.new_module_code, source.action_code, source.allowed
from public.user_permissions source
join permission_map
  on permission_map.old_module_code = source.module_code
 and permission_map.action_code = source.action_code
where not exists (
  select 1
  from public.user_permissions existing
  where existing.user_id = source.user_id
    and existing.module_code = permission_map.new_module_code
    and existing.action_code = source.action_code
);

commit;
