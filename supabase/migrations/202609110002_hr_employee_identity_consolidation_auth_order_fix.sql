begin;

create or replace function public.consolidate_hr_employee_identity_atomic(
  p_organization_id uuid,
  p_canonical_employee_id uuid,
  p_duplicate_employee_id uuid,
  p_expected_user_id uuid,
  p_actor jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  canonical_employee public.hr_employees%rowtype;
  duplicate_employee public.hr_employees%rowtype;
  other_owner uuid;
begin
  if p_canonical_employee_id = p_duplicate_employee_id then
    raise exception 'Canonical and duplicate employee IDs must differ.';
  end if;

  select * into canonical_employee
    from public.hr_employees
   where id = p_canonical_employee_id
     and organization_id = p_organization_id
   for update;
  if not found then raise exception 'Canonical employee is outside the organization.'; end if;
  if canonical_employee.employee_code <> 'MRC0260' then raise exception 'Canonical employee validation failed.'; end if;
  if canonical_employee.status <> 'active' then raise exception 'Canonical employee must be active.'; end if;
  if canonical_employee.user_id is not null then raise exception 'Canonical employee already has a user linkage.'; end if;

  select * into duplicate_employee
    from public.hr_employees
   where id = p_duplicate_employee_id
     and organization_id = p_organization_id
   for update;
  if not found then raise exception 'Duplicate employee is outside the organization.'; end if;
  if duplicate_employee.employee_code <> '02' then raise exception 'Duplicate employee validation failed.'; end if;
  if duplicate_employee.user_id is distinct from p_expected_user_id then raise exception 'Duplicate employee does not own the expected auth user.'; end if;

  select id into other_owner from public.hr_employees
   where organization_id = p_organization_id
     and user_id = p_expected_user_id
     and id not in (p_canonical_employee_id, p_duplicate_employee_id)
   limit 1;
  if other_owner is not null then raise exception 'Auth user is linked to another employee.'; end if;

  update public.hr_employees
     set user_id = null,
         updated_by = nullif(p_actor->>'user_id','')::uuid,
         updated_by_name = nullif(p_actor->>'name',''),
         updated_by_email = nullif(p_actor->>'email',''),
         updated_at = now()
   where id = duplicate_employee.id;

  update public.hr_employees
     set user_id = p_expected_user_id,
         updated_by = nullif(p_actor->>'user_id','')::uuid,
         updated_by_name = nullif(p_actor->>'name',''),
         updated_by_email = nullif(p_actor->>'email',''),
         updated_at = now()
   where id = canonical_employee.id;

  update public.hr_employees
     set status = 'deleted',
         updated_by = nullif(p_actor->>'user_id','')::uuid,
         updated_by_name = nullif(p_actor->>'name',''),
         updated_by_email = nullif(p_actor->>'email',''),
         updated_at = now()
   where id = duplicate_employee.id;

  insert into public.erp_audit_logs (
    organization_id, company_id, entity_type, record_id, module_code, action,
    description, old_values, new_values, source, created_by, created_by_name, created_by_email
  ) values (
    p_organization_id, duplicate_employee.company_id, 'hr_employee', duplicate_employee.id,
    'hr_employees', 'restore', 'Duplicate employee record consolidated into MRC0260.',
    jsonb_build_object('canonical_employee_id', canonical_employee.id, 'duplicate_employee_id', duplicate_employee.id, 'duplicate_user_id', p_expected_user_id, 'duplicate_status', duplicate_employee.status),
    jsonb_build_object('canonical_employee_id', canonical_employee.id, 'canonical_user_id', p_expected_user_id, 'duplicate_status', 'deleted', 'duplicate_user_id', null),
    'manual', nullif(p_actor->>'user_id','')::uuid, nullif(p_actor->>'name',''), nullif(p_actor->>'email','')
  );

  return jsonb_build_object('ok', true, 'canonical_employee_id', canonical_employee.id, 'retired_employee_id', duplicate_employee.id, 'user_id', p_expected_user_id);
end;
$$;

revoke all on function public.consolidate_hr_employee_identity_atomic(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.consolidate_hr_employee_identity_atomic(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;
