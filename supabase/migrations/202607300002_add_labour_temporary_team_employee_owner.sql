-- Labour Phase 3: daily temporary engineer teams.
-- Reuses labour_work_groups and labour_work_group_members for engineer-owned daily teams.

begin;

alter table public.labour_work_groups
  add column if not exists engineer_employee_id uuid references public.hr_employees(id) on delete restrict;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'labour_work_groups'
      and constraint_name = 'labour_work_groups_status_check'
  ) then
    alter table public.labour_work_groups drop constraint labour_work_groups_status_check;
  end if;
end $$;

alter table public.labour_work_groups
  add constraint labour_work_groups_status_check
  check (status in ('draft', 'submitted', 'verified', 'approved', 'locked', 'cancelled'));

create unique index if not exists labour_temporary_teams_number_uidx
  on public.labour_work_groups (organization_id, company_id, site_id, work_date, engineer_employee_id, group_number)
  where group_type = 'engineer_group'
    and status <> 'cancelled'
    and engineer_employee_id is not null
    and group_number is not null;

create index if not exists labour_temporary_teams_engineer_scope_idx
  on public.labour_work_groups (organization_id, company_id, site_id, work_date, engineer_employee_id, status)
  where group_type = 'engineer_group';

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values ('labour_engineer_groups', 'Temporary Teams', 'hr', '/labour/teams', 'active', 3.75)
on conflict (module_code) do update
set module_name = excluded.module_name,
    module_group = excluded.module_group,
    route = excluded.route,
    status = excluded.status,
    sort_order = excluded.sort_order;

with engineer_team_permissions(module_code, action_code) as (
  values
    ('labour_engineer_groups', 'view'),
    ('labour_engineer_groups', 'create'),
    ('labour_engineer_groups', 'edit'),
    ('labour_engineer_groups', 'delete')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
update public.role_permissions rp
set allowed = true
from system_roles r
cross join engineer_team_permissions p
where rp.role_id = r.id
  and rp.module_code = p.module_code
  and rp.action_code = p.action_code;

with engineer_team_permissions(module_code, action_code) as (
  values
    ('labour_engineer_groups', 'view'),
    ('labour_engineer_groups', 'create'),
    ('labour_engineer_groups', 'edit'),
    ('labour_engineer_groups', 'delete')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from system_roles r
cross join engineer_team_permissions p
where not exists (
  select 1
  from public.role_permissions rp
  where rp.role_id = r.id
    and rp.module_code = p.module_code
    and rp.action_code = p.action_code
);

commit;
