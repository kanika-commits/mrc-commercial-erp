begin;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
values ('project_management', 'credit_notes', 'Credit Notes', '/credit-notes', 8.5, 'active')
on conflict (module_code) do update
set module_group = excluded.module_group,
    module_name = excluded.module_name,
    route = excluded.route,
    sort_order = excluded.sort_order,
    status = excluded.status;

insert into public.role_permissions (role_id, module_code, action_code, allowed)
select source.role_id, 'credit_notes', source.action_code, source.allowed
from public.role_permissions source
where source.module_code = 'credit_note_approval'
  and source.action_code in ('view', 'approve', 'reject')
  and not exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = source.role_id
      and existing.module_code = 'credit_notes'
      and existing.action_code = source.action_code
  );

insert into public.user_permissions (user_id, module_code, action_code, allowed)
select source.user_id, 'credit_notes', source.action_code, source.allowed
from public.user_permissions source
where source.module_code = 'credit_note_approval'
  and source.action_code in ('view', 'approve', 'reject')
  and not exists (
    select 1
    from public.user_permissions existing
    where existing.user_id = source.user_id
      and existing.module_code = 'credit_notes'
      and existing.action_code = source.action_code
  );

commit;
