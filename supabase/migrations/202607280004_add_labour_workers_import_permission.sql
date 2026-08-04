insert into public.role_permissions (
  role_id,
  module_code,
  action_code,
  allowed,
  created_at
)
select
  r.id,
  'labour_workers',
  'import',
  true,
  now()
from public.roles r
where r.role_code in ('platform_owner', 'super_admin')
  and not exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = r.id
      and rp.module_code = 'labour_workers'
      and rp.action_code = 'import'
  );

update public.role_permissions
set allowed = true
where module_code = 'labour_workers'
  and action_code = 'import'
  and role_id in (
    select id
    from public.roles
    where role_code in ('platform_owner', 'super_admin')
  );
