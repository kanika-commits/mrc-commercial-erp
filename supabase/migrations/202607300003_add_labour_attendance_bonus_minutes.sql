begin;

alter table public.labour_attendance
  add column if not exists bonus_minutes integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_attendance_bonus_minutes_check'
      and conrelid = 'public.labour_attendance'::regclass
  ) then
    alter table public.labour_attendance
      add constraint labour_attendance_bonus_minutes_check
      check (bonus_minutes is null or bonus_minutes >= 0);
  end if;
end $$;

create index if not exists labour_attendance_bonus_minutes_idx
  on public.labour_attendance (organization_id, company_id, site_id, attendance_date)
  where bonus_minutes is not null;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values ('labour_engineer_daily', 'Engineer Daily Labour', 'hr', '/labour/engineer-daily', 'active', 3.75)
on conflict (module_code) do update
set module_name = excluded.module_name,
    module_group = excluded.module_group,
    route = excluded.route,
    status = excluded.status,
    sort_order = excluded.sort_order;

with engineer_daily_permissions(module_code, action_code) as (
  values
    ('labour_engineer_daily', 'view'),
    ('labour_engineer_daily', 'add'),
    ('labour_engineer_daily', 'edit'),
    ('labour_engineer_daily', 'submit')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
update public.role_permissions rp
set allowed = true
from system_roles r
cross join engineer_daily_permissions p
where rp.role_id = r.id
  and rp.module_code = p.module_code
  and rp.action_code = p.action_code;

with engineer_daily_permissions(module_code, action_code) as (
  values
    ('labour_engineer_daily', 'view'),
    ('labour_engineer_daily', 'add'),
    ('labour_engineer_daily', 'edit'),
    ('labour_engineer_daily', 'submit')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from system_roles r
cross join engineer_daily_permissions p
where not exists (
  select 1
  from public.role_permissions rp
  where rp.role_id = r.id
    and rp.module_code = p.module_code
    and rp.action_code = p.action_code
);

commit;
