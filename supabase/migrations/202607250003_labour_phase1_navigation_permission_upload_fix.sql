-- Labour Phase 1 metadata correction.
-- Safe to run after Labour Foundation and Labour Management V2 migrations.
-- Non-destructive: adds missing module metadata and private storage bucket only.

begin;

do $$
begin
  if to_regclass('public.erp_modules') is not null then
    insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
    values
      ('labour_management', 'labour_attendance_unlock', 'Attendance Unlock', '/labour/attendance/daily', 9.5, 'active')
    on conflict (module_code) do update
      set module_group = excluded.module_group,
          module_name = excluded.module_name,
          route = excluded.route,
          sort_order = excluded.sort_order,
          status = excluded.status;
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('labour-documents', 'labour-documents', false)
on conflict (id) do update
  set public = false;

commit;
