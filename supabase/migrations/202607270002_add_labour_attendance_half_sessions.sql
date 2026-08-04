-- Labour Attendance half-session capture.
-- Additive only; do not rewrite historical attendance rows.

begin;

alter table public.labour_attendance
  add column if not exists site_in_id uuid references public.labour_site_ins(id) on delete set null,
  add column if not exists first_half_present boolean,
  add column if not exists second_half_present boolean,
  add column if not exists override_reason text;

create index if not exists labour_attendance_site_in_idx
  on public.labour_attendance (site_in_id);

with modules(module_code, action_code) as (
  values
    ('labour_attendance', 'override')
),
super_admin_roles as (
  select id from public.roles where lower(role_code) = 'super_admin'
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, m.module_code, m.action_code, true
from super_admin_roles r
cross join modules m
where not exists (
  select 1 from public.role_permissions rp
  where rp.role_id = r.id and rp.module_code = m.module_code and rp.action_code = m.action_code
);

commit;
