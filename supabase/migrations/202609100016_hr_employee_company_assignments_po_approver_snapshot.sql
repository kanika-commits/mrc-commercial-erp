begin;

create table if not exists public.hr_employee_company_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  designation_id uuid not null references public.hr_designations(id) on delete restrict,
  status text not null default 'active',
  effective_from date,
  effective_to date,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz
);

create unique index if not exists hr_employee_company_assignments_active_uidx
  on public.hr_employee_company_assignments (employee_id, company_id)
  where status = 'active';

create index if not exists hr_employee_company_assignments_scope_idx
  on public.hr_employee_company_assignments (organization_id, employee_id, company_id, status);

create or replace function public.validate_hr_employee_company_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.hr_employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then
    raise exception 'Employee does not belong to the selected organization.';
  end if;
  if not exists (select 1 from public.companies c where c.id = new.company_id and c.organization_id = new.organization_id and c.status = 'active') then
    raise exception 'Company is not active or does not belong to the selected organization.';
  end if;
  if not exists (select 1 from public.hr_designations d where d.id = new.designation_id and d.organization_id = new.organization_id and d.status = 'active') then
    raise exception 'Designation is not active or does not belong to the selected organization.';
  end if;
  if new.effective_to is not null and new.effective_from is not null and new.effective_to < new.effective_from then
    raise exception 'Assignment effective dates are invalid.';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_employee_company_assignments_validate on public.hr_employee_company_assignments;
create trigger hr_employee_company_assignments_validate
before insert or update on public.hr_employee_company_assignments
for each row execute function public.validate_hr_employee_company_assignment();

insert into public.hr_employee_company_assignments (organization_id, employee_id, company_id, designation_id, status, effective_from)
select e.organization_id, e.id, e.company_id, e.designation_id, 'active', coalesce(e.date_of_joining, current_date)
from public.hr_employees e
where e.company_id is not null
  and e.designation_id is not null
  and e.status = 'active'
  and not exists (
    select 1 from public.hr_employee_company_assignments a
    where a.employee_id = e.id and a.company_id = e.company_id and a.status = 'active'
  );

alter table public.procurement_purchase_orders
  add column if not exists approved_by_employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists approved_by_company_id uuid references public.companies(id) on delete set null,
  add column if not exists approved_by_company_name text,
  add column if not exists approved_by_designation_id uuid references public.hr_designations(id) on delete set null,
  add column if not exists approved_by_designation_name text,
  add column if not exists approved_signature_profile_id uuid references public.employee_signature_profiles(id) on delete set null;

create or replace function public.transition_procurement_purchase_order_atomic(p_purchase_order_id uuid,p_organization_id uuid,p_action text,p_actor jsonb,p_note text default null::text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_status text;
  v_manifest jsonb;
  v_employee public.hr_employees%rowtype;
  v_assignment public.hr_employee_company_assignments%rowtype;
  v_company_name text;
  v_designation_name text;
  v_signature_id uuid;
begin
  if nullif(p_actor->>'user_id','') is null then raise exception 'Authenticated actor is required.'; end if;
  select * into v_po from public.procurement_purchase_orders where id=p_purchase_order_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found.'; end if;
  v_status := case p_action when 'submit' then 'pending_approval' when 'approve' then 'approved' when 'send_back' then 'sent_back' when 'reject' then 'rejected' when 'issue' then 'issued' else null end;
  if v_status is null then raise exception 'Unsupported Purchase Order action.'; end if;
  if p_action='submit' and v_po.status not in ('draft','sent_back') then raise exception 'Only Draft or Sent Back Purchase Orders can be submitted.'; end if;
  if p_action in ('approve','send_back','reject') and v_po.status <> 'pending_approval' then raise exception 'Only Pending Approval Purchase Orders can be acted on.'; end if;
  if p_action='issue' and v_po.status <> 'approved' then raise exception 'Only Approved Purchase Orders can be issued.'; end if;

  if p_action = 'submit' then
    select coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'manifest_order',d.manifest_order,'sort_order',d.sort_order,'original_file_name',d.original_file_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,'storage_provider',d.storage_provider,'storage_bucket',d.storage_bucket,'storage_key',d.storage_key,'included_in_pdf',d.mime_type in ('application/pdf','image/jpeg','image/png','image/webp')) order by coalesce(d.sort_order,2147483647),d.created_at,d.id),'[]'::jsonb) into v_manifest
    from (select d.*,row_number() over(order by coalesce(d.sort_order,2147483647),d.created_at,d.id) as manifest_order from public.procurement_purchase_order_documents d where d.purchase_order_id=v_po.id and d.organization_id=v_po.organization_id and d.status='active') d;
  end if;

  if p_action = 'approve' then
    select e.* into v_employee
      from public.hr_employees e
     where e.user_id = nullif(p_actor->>'user_id','')::uuid
       and e.organization_id = v_po.organization_id
       and e.status = 'active'
     order by e.id
     limit 1;
    if not found then raise exception 'No active employee profile is configured for this approver.'; end if;
    select a.* into v_assignment
      from public.hr_employee_company_assignments a
      join public.hr_designations d on d.id = a.designation_id
     where a.employee_id = v_employee.id
       and a.organization_id = v_po.organization_id
       and a.company_id = v_po.company_id
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.effective_to is null or a.effective_to >= current_date)
       and d.organization_id = v_po.organization_id
       and d.status = 'active';
    if not found then raise exception 'No active designation is configured for this employee under the selected PO company.'; end if;
    select d.designation_name into v_designation_name from public.hr_designations d where d.id = v_assignment.designation_id and d.organization_id = v_po.organization_id;
    select c.company_name into v_company_name from public.companies c where c.id = v_po.company_id and c.organization_id = v_po.organization_id;
    select s.id into v_signature_id from public.employee_signature_profiles s where s.employee_id = v_employee.id and s.organization_id = v_po.organization_id and s.is_active = true order by s.updated_at desc nulls last, s.created_at desc limit 1;
  end if;

  update public.procurement_purchase_orders set
    status=v_status,
    supporting_documents_manifest=case when p_action='submit' then v_manifest else supporting_documents_manifest end,
    submitted_by=case when p_action='submit' then nullif(p_actor->>'user_id','')::uuid else submitted_by end,
    submitted_by_name=case when p_action='submit' then p_actor->>'name' else submitted_by_name end,
    submitted_at=case when p_action='submit' then now() else submitted_at end,
    approved_by=case when p_action='approve' then nullif(p_actor->>'user_id','')::uuid else approved_by end,
    approved_by_name=case when p_action='approve' then p_actor->>'name' else approved_by_name end,
    approved_at=case when p_action='approve' then now() else approved_at end,
    approved_by_employee_id=case when p_action='approve' then v_employee.id else approved_by_employee_id end,
    approved_by_company_id=case when p_action='approve' then v_po.company_id else approved_by_company_id end,
    approved_by_company_name=case when p_action='approve' then v_company_name else approved_by_company_name end,
    approved_by_designation_id=case when p_action='approve' then v_assignment.designation_id else approved_by_designation_id end,
    approved_by_designation_name=case when p_action='approve' then v_designation_name else approved_by_designation_name end,
    approved_signature_profile_id=case when p_action='approve' then v_signature_id else approved_signature_profile_id end,
    issued_by=case when p_action='issue' then nullif(p_actor->>'user_id','')::uuid else issued_by end,
    issued_by_name=case when p_action='issue' then p_actor->>'name' else issued_by_name end,
    issued_at=case when p_action='issue' then now() else issued_at end,
    updated_at=now()
  where id=v_po.id;
  insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_po.id,p_action,p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  return jsonb_build_object('purchase_order_id',v_po.id,'status',v_status);
end;
$$;

revoke all on table public.hr_employee_company_assignments from public, anon, authenticated;
grant all on table public.hr_employee_company_assignments to service_role;
revoke all on function public.validate_hr_employee_company_assignment() from public, anon, authenticated;
grant execute on function public.validate_hr_employee_company_assignment() to service_role;
revoke all on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text) to service_role;

commit;
