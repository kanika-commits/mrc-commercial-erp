-- Labour Engineer Groups Phase 2: Site-In group creation and membership.
-- Safe to run after the Labour Site-In and Daily Work foundation migrations.

begin;

alter table public.labour_work_groups
  add column if not exists engineer_user_id uuid references public.profiles(id) on delete restrict,
  add column if not exists group_number integer,
  add column if not exists group_label text,
  add column if not exists group_type text not null default 'engineer_group'
    check (group_type in ('legacy_crew', 'engineer_group'));

alter table public.labour_work_groups
  alter column commercial_model set default 'contract_basis';

alter table public.labour_work_group_members
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists company_id uuid references public.companies(id) on delete restrict,
  add column if not exists site_id uuid references public.sites(id) on delete restrict,
  add column if not exists work_date date,
  add column if not exists contractor_profile_id uuid references public.labour_contractor_profiles(id) on delete restrict,
  add column if not exists site_in_id uuid references public.labour_site_ins(id) on delete restrict,
  add column if not exists site_in_time_snapshot time,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'cancelled')),
  add column if not exists assigned_by uuid,
  add column if not exists assigned_by_name text,
  add column if not exists assigned_by_email text,
  add column if not exists assigned_at timestamptz not null default now(),
  add column if not exists updated_by uuid,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text,
  add column if not exists updated_at timestamptz;

create unique index if not exists labour_engineer_groups_number_uidx
  on public.labour_work_groups (organization_id, company_id, site_id, work_date, engineer_user_id, group_number)
  where group_type = 'engineer_group' and status <> 'locked' and engineer_user_id is not null and group_number is not null;

create index if not exists labour_engineer_groups_scope_idx
  on public.labour_work_groups (organization_id, company_id, site_id, work_date, engineer_user_id, contractor_profile_id, status)
  where group_type = 'engineer_group';

create unique index if not exists labour_engineer_group_members_worker_day_uidx
  on public.labour_work_group_members (organization_id, company_id, site_id, work_date, labour_worker_id)
  where status = 'active' and organization_id is not null and company_id is not null and site_id is not null and work_date is not null;

create index if not exists labour_engineer_group_members_group_idx
  on public.labour_work_group_members (work_group_id, status, assigned_at);

create index if not exists labour_engineer_group_members_site_in_idx
  on public.labour_work_group_members (site_in_id)
  where site_in_id is not null;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values ('labour_engineer_groups', 'Labour Engineer Groups', 'hr', '/labour/site-in', 'active', 3.6)
on conflict (module_code) do update
set module_name = excluded.module_name,
    module_group = excluded.module_group,
    route = excluded.route,
    status = excluded.status,
    sort_order = excluded.sort_order;

with engineer_group_permissions(module_code, action_code) as (
  values
    ('labour_engineer_groups', 'view'),
    ('labour_engineer_groups', 'create')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
update public.role_permissions rp
set allowed = true
from system_roles r
cross join engineer_group_permissions p
where rp.role_id = r.id
  and rp.module_code = p.module_code
  and rp.action_code = p.action_code;

with engineer_group_permissions(module_code, action_code) as (
  values
    ('labour_engineer_groups', 'view'),
    ('labour_engineer_groups', 'create')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from system_roles r
cross join engineer_group_permissions p
where not exists (
  select 1
  from public.role_permissions rp
  where rp.role_id = r.id
    and rp.module_code = p.module_code
    and rp.action_code = p.action_code
);

commit;
