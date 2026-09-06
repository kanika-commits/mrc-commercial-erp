-- Purchase Requisition line-level requester foundation.
-- This migration assumes line_key and requisition_item_line_key were added by 110009.
-- It is intentionally unapplied.

alter table public.purchase_requisition_items
  add column if not exists purpose text;

alter table public.purchase_requisition_items
  add column if not exists requested_by_employee_id uuid,
  add column if not exists requested_by_name_snapshot text;

create index if not exists purchase_requisition_items_requested_by_idx
  on public.purchase_requisition_items (requested_by_employee_id);

create or replace function public.create_purchase_requisition_atomic(
  p_header jsonb, p_items jsonb, p_snapshots jsonb, p_event jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_number text;
  v_item jsonb;
  v_make jsonb;
  v_item_id uuid;
  v_item_master public.procurement_items%rowtype;
  v_uom_master public.procurement_uoms%rowtype;
  v_requested_uom_id uuid;
  v_quantity numeric;
  v_line_key uuid;
  v_line_keys jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_min_required_by date;
  v_requested_by_name text;
begin
  if not exists (select 1 from public.sites s where s.id = nullif(p_header->>'site_id', '')::uuid and s.organization_id = nullif(p_header->>'organization_id', '')::uuid and (s.company_id = nullif(p_header->>'company_id', '')::uuid or s.company_id is null) and s.status = 'active') then
    raise exception 'Selected company and site are invalid for this organization.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one requisition item is required.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(v_item->>'required_by_date'), '') is null then
      raise exception 'Required by date is required for every material line.';
    end if;
    if nullif(trim(v_item->>'purpose'), '') is null then
      raise exception 'Purpose / Requirement is required for every material line.';
    end if;
    v_min_required_by := case when v_min_required_by is null or (v_item->>'required_by_date')::date < v_min_required_by
      then (v_item->>'required_by_date')::date else v_min_required_by end;
    select e.employee_name into v_requested_by_name
      from public.hr_employees e
     where e.id = nullif(v_item->>'requested_by_employee_id', '')::uuid
       and e.organization_id = (p_header->>'organization_id')::uuid

       and e.status = 'active'
       and (e.site_id = (p_header->>'site_id')::uuid or exists (
         select 1 from public.sites ho
          where ho.id = e.site_id and ho.organization_id = e.organization_id
             and ho.status = 'active' and ho.site_code = 'HO'
       ));
    if not found then raise exception 'Requested-by employee is invalid on a material line.'; end if;
  end loop;
  if exists (
    select 1
      from (
        select value->>'line_key' as line_key
          from jsonb_array_elements(p_items)
         where nullif(value->>'line_key', '') is not null
      ) submitted
     group by line_key
    having count(*) > 1
  ) then raise exception 'Duplicate material line key supplied.'; end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) submitted
     where nullif(submitted.value->>'line_key', '') is not null
       and exists (
         select 1
           from public.purchase_requisition_items existing_item
          where existing_item.line_key = (submitted.value->>'line_key')::uuid
       )
  ) then raise exception 'Material line key is already assigned.'; end if;
  v_number := public.next_purchase_requisition_number((p_header->>'organization_id')::uuid, (p_header->>'site_id')::uuid);
  insert into public.purchase_requisitions (
    id, organization_id, requisition_number, requisition_date, company_id, site_id,
    requested_by_user_id, requested_by_name, requested_by_email, required_by_date, priority,
    purpose, remarks, status, approval_status, submitted_at, submitted_by, submitted_by_name,
    submitted_by_email, created_by, created_by_name, created_by_email
  ) select v_id, (p_header->>'organization_id')::uuid, v_number, (p_header->>'requisition_date')::date,
    (p_header->>'company_id')::uuid, (p_header->>'site_id')::uuid, (p_header->>'requested_by_user_id')::uuid,
    p_header->>'requested_by_name', p_header->>'requested_by_email', v_min_required_by,
    'Normal', nullif(trim(p_header->>'purpose'), ''), nullif(p_header->>'remarks',''), 'draft',
    'draft', null, null, null,
    null, (p_header->>'created_by')::uuid,
    p_header->>'created_by_name', p_header->>'created_by_email';
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_line_key := coalesce(nullif(v_item->>'line_key', '')::uuid, gen_random_uuid());
    select e.employee_name into v_requested_by_name
      from public.hr_employees e
     where e.id = nullif(v_item->>'requested_by_employee_id', '')::uuid
       and e.organization_id = (p_header->>'organization_id')::uuid

       and e.status = 'active'
       and (e.site_id = (p_header->>'site_id')::uuid or exists (
         select 1 from public.sites ho
          where ho.id = e.site_id and ho.organization_id = e.organization_id
             and ho.status = 'active' and ho.site_code = 'HO'
       ));
    v_requested_uom_id := nullif(v_item->>'uom_id', '')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    select * into v_item_master
      from public.procurement_items
     where id = nullif(v_item->>'item_id', '')::uuid
       and organization_id = (p_header->>'organization_id')::uuid
       and status = 'active';
    if not found then raise exception 'Active item was not found on line %.', v_index; end if;
    if v_item_master.default_uom_id is null or (v_requested_uom_id is not null and v_requested_uom_id <> v_item_master.default_uom_id) then
      raise exception 'Selected UOM does not match the Item Master on line %.', v_index;
    end if;
    select * into v_uom_master
      from public.procurement_uoms
     where id = v_item_master.default_uom_id and organization_id = v_item_master.organization_id and status = 'active';
    if not found then raise exception 'Active UOM was not found on line %.', v_index; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be greater than 0 on line %.', v_index; end if;
    insert into public.purchase_requisition_items (
      requisition_id, line_key, item_id, item_name_snapshot, item_code_snapshot, specification, purpose, make_brand,
      uom_id, uom_snapshot, quantity, required_by_date, requested_by_employee_id, requested_by_name_snapshot, remarks, sort_order
    ) values (
      v_id, v_line_key, v_item_master.id, v_item_master.item_name, v_item_master.item_code,
      nullif(v_item->>'specification',''), nullif(trim(v_item->>'purpose'), ''), nullif(v_item->>'make_brand',''), v_uom_master.id,
      v_uom_master.uom_code, v_quantity, (v_item->>'required_by_date')::date,
      nullif(v_item->>'requested_by_employee_id', '')::uuid, v_requested_by_name, nullif(v_item->>'remarks',''), coalesce((v_item->>'sort_order')::integer,v_index)
    ) returning id into v_item_id;
    v_line_keys := v_line_keys || jsonb_build_array(v_line_key);
    for v_make in select value from jsonb_array_elements(coalesce(p_snapshots->(v_index-1),'[]'::jsonb)) loop
      insert into public.purchase_requisition_item_approved_makes(requisition_item_id,make_name_snapshot,sort_order)
      values(v_item_id,v_make #>> '{}',1);
    end loop;
  end loop;
  insert into public.purchase_requisition_events(requisition_id,event_type,event_note,from_status,to_status,created_by,created_by_name,created_by_email)
  values(v_id,p_event->>'event_type',p_event->>'event_note',p_event->>'from_status',p_event->>'to_status',(p_event->>'created_by')::uuid,p_event->>'created_by_name',p_event->>'created_by_email');
  return jsonb_build_object('id',v_id,'requisition_number',v_number,'line_keys',v_line_keys);
end; $$;

create or replace function public.update_purchase_requisition_atomic(
  p_requisition_id uuid, p_organization_id uuid, p_header jsonb, p_items jsonb, p_snapshots jsonb, p_event jsonb
) returns void language plpgsql set search_path = public as $$
declare
  v_requisition public.purchase_requisitions%rowtype;
  v_target_company_id uuid;
  v_target_site_id uuid;
  v_item jsonb;
  v_make jsonb;
  v_item_id uuid;
  v_item_master public.procurement_items%rowtype;
  v_uom_master public.procurement_uoms%rowtype;
  v_requested_uom_id uuid;
  v_quantity numeric;
  v_line_key uuid;
  v_index integer := 0;
  v_min_required_by date;
  v_requested_by_name text;
begin
  select * into v_requisition
    from public.purchase_requisitions
   where id = p_requisition_id and organization_id = p_organization_id
   for update;
  if not found or v_requisition.status not in ('draft','sent_back') then raise exception 'Requisition is not editable.'; end if;
  v_target_company_id := nullif(p_header->>'company_id', '')::uuid;
  v_target_site_id := nullif(p_header->>'site_id', '')::uuid;
  if v_target_company_id is null or v_target_site_id is null then raise exception 'Company and site are required.'; end if;
  if not exists (select 1 from public.sites s where s.id = v_target_site_id and s.organization_id = v_requisition.organization_id and (s.company_id = v_target_company_id or s.company_id is null) and s.status = 'active') then
    raise exception 'Selected company and site are invalid for this organization.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one requisition item is required.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(v_item->>'required_by_date'), '') is null then raise exception 'Required by date is required for every material line.'; end if;
    if nullif(trim(v_item->>'purpose'), '') is null then raise exception 'Purpose / Requirement is required for every material line.'; end if;
    v_min_required_by := case when v_min_required_by is null or (v_item->>'required_by_date')::date < v_min_required_by then (v_item->>'required_by_date')::date else v_min_required_by end;
    select e.employee_name into v_requested_by_name from public.hr_employees e where e.id = nullif(v_item->>'requested_by_employee_id', '')::uuid and e.organization_id = v_requisition.organization_id  and e.status = 'active' and (e.site_id = (p_header->>'site_id')::uuid or exists (select 1 from public.sites ho where ho.id = e.site_id and ho.organization_id = e.organization_id  and ho.status = 'active' and ho.site_code = 'HO'));
    if not found then raise exception 'Requested-by employee is invalid on a material line.'; end if;
  end loop;
  if exists (
    select 1
      from (
        select value->>'line_key' as line_key
          from jsonb_array_elements(p_items)
         where nullif(value->>'line_key', '') is not null
      ) submitted
     group by line_key
    having count(*) > 1
  ) then raise exception 'Duplicate material line key supplied.'; end if;
  update public.purchase_requisitions set company_id=v_target_company_id,site_id=v_target_site_id,required_by_date=v_min_required_by,requisition_date=(p_header->>'requisition_date')::date,priority=case when p_header->>'priority' in ('Normal','Urgent','Critical') then p_header->>'priority' else priority end,purpose=case when p_header ? 'purpose' then nullif(trim(p_header->>'purpose'),'') else purpose end,remarks=case when p_header ? 'remarks' then nullif(p_header->>'remarks','') else remarks end,sent_back_reason=nullif(p_header->>'sent_back_reason',''),updated_by=(p_header->>'updated_by')::uuid,updated_by_name=p_header->>'updated_by_name',updated_by_email=p_header->>'updated_by_email',updated_at=now()
  where id=p_requisition_id and organization_id=p_organization_id and status in ('draft','sent_back');
  if not found then raise exception 'Requisition is not editable.'; end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) submitted
     where nullif(submitted.value->>'line_key', '') is not null
       and exists (
         select 1
           from public.purchase_requisition_items existing_item
          where existing_item.line_key = (submitted.value->>'line_key')::uuid
            and existing_item.requisition_id <> p_requisition_id
       )
  ) then raise exception 'Material line key belongs to another requisition.'; end if;
  update public.purchase_requisition_documents
     set status = 'deleted', updated_at = now()
   where requisition_id = p_requisition_id
     and status = 'active'
     and requisition_item_line_key is not null
     and not exists (
       select 1
         from jsonb_array_elements(p_items) submitted
        where nullif(submitted.value->>'line_key', '')::uuid = requisition_item_line_key
     );
  delete from public.purchase_requisition_item_approved_makes where requisition_item_id in (select id from public.purchase_requisition_items where requisition_id=p_requisition_id);
  delete from public.purchase_requisition_items where requisition_id=p_requisition_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_line_key := coalesce(nullif(v_item->>'line_key', '')::uuid, gen_random_uuid());
    select e.employee_name into v_requested_by_name from public.hr_employees e where e.id = nullif(v_item->>'requested_by_employee_id', '')::uuid and e.organization_id = v_requisition.organization_id  and e.status = 'active' and (e.site_id = v_target_site_id or exists (select 1 from public.sites ho where ho.id = e.site_id and ho.organization_id = e.organization_id  and ho.status = 'active' and ho.site_code = 'HO'));
    v_requested_uom_id := nullif(v_item->>'uom_id', '')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    select * into v_item_master from public.procurement_items where id = nullif(v_item->>'item_id', '')::uuid and organization_id = v_requisition.organization_id and status = 'active';
    if not found then raise exception 'Active item was not found on line %.', v_index; end if;
    if v_item_master.default_uom_id is null or (v_requested_uom_id is not null and v_requested_uom_id <> v_item_master.default_uom_id) then raise exception 'Selected UOM does not match the Item Master on line %.', v_index; end if;
    select * into v_uom_master from public.procurement_uoms where id = v_item_master.default_uom_id and organization_id = v_requisition.organization_id and status = 'active';
    if not found then raise exception 'Active UOM was not found on line %.', v_index; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be greater than 0 on line %.', v_index; end if;
    insert into public.purchase_requisition_items(requisition_id,line_key,item_id,item_name_snapshot,item_code_snapshot,specification,purpose,make_brand,uom_id,uom_snapshot,quantity,required_by_date,requested_by_employee_id,requested_by_name_snapshot,remarks,sort_order)
    values(p_requisition_id,v_line_key,v_item_master.id,v_item_master.item_name,v_item_master.item_code,nullif(v_item->>'specification',''),nullif(trim(v_item->>'purpose'), ''),nullif(v_item->>'make_brand',''),v_uom_master.id,v_uom_master.uom_code,v_quantity,(v_item->>'required_by_date')::date,nullif(v_item->>'requested_by_employee_id','')::uuid,v_requested_by_name,nullif(v_item->>'remarks',''),coalesce((v_item->>'sort_order')::integer,v_index)) returning id into v_item_id;
    for v_make in select value from jsonb_array_elements(coalesce(p_snapshots->(v_index-1),'[]'::jsonb)) loop
      insert into public.purchase_requisition_item_approved_makes(requisition_item_id,make_name_snapshot,sort_order)
      values(v_item_id,v_make #>> '{}',(select count(*) from public.purchase_requisition_item_approved_makes where requisition_item_id = v_item_id) + 1);
    end loop;
  end loop;
  insert into public.purchase_requisition_events(requisition_id,event_type,event_note,from_status,to_status,created_by,created_by_name,created_by_email) values(p_requisition_id,p_event->>'event_type',p_event->>'event_note',p_event->>'from_status',p_event->>'to_status',(p_event->>'created_by')::uuid,p_event->>'created_by_name',p_event->>'created_by_email');
end; $$;

create or replace function public.edit_purchase_requisition_during_approval_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_snapshots jsonb,
  p_actor jsonb,
  p_event jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  current_step public.purchase_requisition_approval_steps%rowtype;
  actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor->>'name'), '');
  actor_email text := nullif(trim(p_actor->>'email'), '');
  latest_cycle integer;
  item_json jsonb;
  snapshot_json jsonb;
  item_row public.procurement_items%rowtype;
  uom_row public.procurement_uoms%rowtype;
  new_item_id uuid;
  inserted_item_id uuid;
  requested_uom_id uuid;
  quantity_value numeric;
  line_key_value uuid;
  item_index integer := 0;
  min_required_by date;
  requested_by_name text;
begin
  if exists (
    select 1
      from (
        select value->>'line_key' as line_key
          from jsonb_array_elements(p_items)
         where nullif(value->>'line_key', '') is not null
      ) submitted
     group by line_key
    having count(*) > 1
  ) then raise exception 'Duplicate material line key supplied.'; end if;
  if actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  if p_requisition_id is null or p_organization_id is null then raise exception 'Requisition scope is required.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one requisition item is required.'; end if;
  select * into requisition_row from public.purchase_requisitions where id = p_requisition_id and organization_id = p_organization_id and status <> 'deleted' for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if requisition_row.status <> 'pending_approval' then raise exception 'Only Pending Approval requisitions can be edited by the current approver.'; end if;
  select max(submission_cycle) into latest_cycle from public.purchase_requisition_approval_steps where requisition_id = requisition_row.id and workflow_version = requisition_row.approval_workflow_version;
  if latest_cycle is null or requisition_row.current_approval_layer is null then raise exception 'Current approval workflow is incomplete.'; end if;
  select * into current_step from public.purchase_requisition_approval_steps where requisition_id = requisition_row.id and workflow_version = requisition_row.approval_workflow_version and submission_cycle = latest_cycle and layer_number = requisition_row.current_approval_layer for update;
  if not found or current_step.status <> 'pending' then raise exception 'Current approval step is no longer pending.'; end if;
  if current_step.approver_user_id <> actor_id then raise exception 'Only the assigned current approver can edit this requisition.'; end if;
  for item_json in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(item_json->>'required_by_date'), '') is null then raise exception 'Required by date is required for every material line.'; end if;
    if nullif(trim(item_json->>'purpose'), '') is null then raise exception 'Purpose / Requirement is required for every material line.'; end if;
    min_required_by := case when min_required_by is null or (item_json->>'required_by_date')::date < min_required_by then (item_json->>'required_by_date')::date else min_required_by end;
    select e.employee_name into requested_by_name from public.hr_employees e where e.id = nullif(item_json->>'requested_by_employee_id', '')::uuid and e.organization_id = requisition_row.organization_id  and e.status = 'active' and (e.site_id = requisition_row.site_id or exists (select 1 from public.sites ho where ho.id = e.site_id and ho.organization_id = e.organization_id  and ho.status = 'active' and ho.site_code = 'HO'));
    if not found then raise exception 'Requested-by employee is invalid on a material line.'; end if;
  end loop;
  if exists (
    select 1
      from jsonb_array_elements(p_items) submitted
     where nullif(submitted.value->>'line_key', '') is not null
       and exists (
         select 1
           from public.purchase_requisition_items existing_item
          where existing_item.line_key = (submitted.value->>'line_key')::uuid
            and existing_item.requisition_id <> requisition_row.id
       )
  ) then raise exception 'Material line key belongs to another requisition.'; end if;
  update public.purchase_requisitions set requisition_date = coalesce(nullif(p_header->>'requisition_date', '')::date, requisition_row.requisition_date), required_by_date = min_required_by, priority = case when p_header->>'priority' in ('Normal', 'Urgent', 'Critical') then p_header->>'priority' else requisition_row.priority end, purpose = case when p_header ? 'purpose' then nullif(trim(p_header->>'purpose'), '') else requisition_row.purpose end, remarks = case when p_header ? 'remarks' then nullif(p_header->>'remarks', '') else requisition_row.remarks end, updated_by = actor_id, updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now() where id = requisition_row.id;
  update public.purchase_requisition_documents
     set status = 'deleted', updated_at = now()
   where requisition_id = requisition_row.id
     and status = 'active'
     and requisition_item_line_key is not null
     and not exists (
       select 1
         from jsonb_array_elements(p_items) submitted
        where nullif(submitted.value->>'line_key', '')::uuid = requisition_item_line_key
     );
  delete from public.purchase_requisition_item_approved_makes where requisition_item_id in (select id from public.purchase_requisition_items where requisition_id = requisition_row.id);
  delete from public.purchase_requisition_items where requisition_id = requisition_row.id;
  for item_json, item_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    new_item_id := nullif(item_json->>'item_id', '')::uuid;
    requested_uom_id := nullif(item_json->>'uom_id', '')::uuid;
    quantity_value := (item_json->>'quantity')::numeric;
    line_key_value := coalesce(nullif(item_json->>'line_key', '')::uuid, gen_random_uuid());
    select e.employee_name into requested_by_name from public.hr_employees e where e.id = nullif(item_json->>'requested_by_employee_id', '')::uuid and e.organization_id = requisition_row.organization_id  and e.status = 'active' and (e.site_id = requisition_row.site_id or exists (select 1 from public.sites ho where ho.id = e.site_id and ho.organization_id = e.organization_id  and ho.status = 'active' and ho.site_code = 'HO'));
    select * into item_row from public.procurement_items where id = new_item_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active item was not found on line %.', item_index; end if;
    if item_row.default_uom_id is null or (requested_uom_id is not null and requested_uom_id <> item_row.default_uom_id) then raise exception 'Selected UOM does not match the Item Master on line %.', item_index; end if;
    select * into uom_row from public.procurement_uoms where id = item_row.default_uom_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active UOM was not found on line %.', item_index; end if;
    if quantity_value is null or quantity_value <= 0 then raise exception 'Quantity must be greater than 0 on line %.', item_index; end if;
    insert into public.purchase_requisition_items (requisition_id, line_key, item_id, item_name_snapshot, item_code_snapshot, specification, purpose, make_brand, uom_id, uom_snapshot, quantity, required_by_date, requested_by_employee_id, requested_by_name_snapshot, remarks, sort_order)
    values (requisition_row.id, line_key_value, item_row.id, item_row.item_name, item_row.item_code, nullif(item_json->>'specification', ''), nullif(trim(item_json->>'purpose'), ''), nullif(item_json->>'make_brand', ''), uom_row.id, uom_row.uom_code, quantity_value, (item_json->>'required_by_date')::date, nullif(item_json->>'requested_by_employee_id', '')::uuid, requested_by_name, nullif(item_json->>'remarks', ''), item_index)
    returning id into inserted_item_id;
    if jsonb_typeof(p_snapshots) = 'array' and jsonb_typeof(p_snapshots->(item_index - 1)) = 'array' then
      for snapshot_json in select value from jsonb_array_elements(p_snapshots->(item_index - 1)) loop
        if nullif(trim(snapshot_json #>> '{}'), '') is not null then
          insert into public.purchase_requisition_item_approved_makes (requisition_item_id, make_name_snapshot, sort_order)
          values (inserted_item_id, trim(snapshot_json #>> '{}'), (select count(*) from public.purchase_requisition_item_approved_makes where requisition_item_id = inserted_item_id) + 1);
        end if;
      end loop;
    end if;
  end loop;
  insert into public.purchase_requisition_events (requisition_id, event_type, event_note, from_status, to_status, created_by, created_by_name, created_by_email)
  values (requisition_row.id, 'edited_during_approval', coalesce(nullif(trim(p_event->>'event_note'), ''), 'Edited during Layer ' || current_step.layer_number || ' — ' || current_step.stage_name || '.'), requisition_row.status, requisition_row.status, actor_id, actor_name, actor_email);
  return jsonb_build_object('requisition_id', requisition_row.id, 'layer_number', current_step.layer_number, 'submission_cycle', latest_cycle);
end; $$;

revoke all on function public.create_purchase_requisition_atomic(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.update_purchase_requisition_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.edit_purchase_requisition_during_approval_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_purchase_requisition_atomic(jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.update_purchase_requisition_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.edit_purchase_requisition_during_approval_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.submit_purchase_requisition_for_approval_atomic(
  p_requisition_id uuid,
  p_actor jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  configuration_row public.purchase_requisition_approval_configurations%rowtype;
  configured_layer record;
  current_item record;
  next_submission_cycle integer;
  active_line_count integer;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;

  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;

  if requisition_row.status not in ('draft', 'sent_back') then
    raise exception 'Only Draft or Sent Back requisitions can be submitted.';
  end if;

  select * into configuration_row
    from public.purchase_requisition_approval_configurations
   where organization_id = requisition_row.organization_id
     and company_id = requisition_row.company_id
     and site_id = requisition_row.site_id
     and status = 'active'
   for update;

  if not found or configuration_row.layer_count not in (2, 3) then
    raise exception 'Indent approval workflow is not configured for this site.';
  end if;

  if (
    select count(*)
      from public.purchase_requisition_approval_layers
     where configuration_id = configuration_row.id
       and workflow_version = configuration_row.workflow_version
       and status = 'active'
  ) <> configuration_row.layer_count
  or exists (
    select 1
      from public.purchase_requisition_approval_layers
     where configuration_id = configuration_row.id
       and workflow_version = configuration_row.workflow_version
       and status = 'active'
       and (layer_number < 1 or layer_number > configuration_row.layer_count
            or nullif(trim(stage_name), '') is null or approver_user_id is null)
  )
  or exists (
    select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
     where not exists (
       select 1 from public.purchase_requisition_approval_layers layer
        where layer.configuration_id = configuration_row.id
          and layer.workflow_version = configuration_row.workflow_version
          and layer.status = 'active'
          and layer.layer_number = expected.layer_number
     )
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (
         select count(*) from public.purchase_requisition_approval_layers duplicate_layer
          where duplicate_layer.configuration_id = configuration_row.id
            and duplicate_layer.workflow_version = configuration_row.workflow_version
            and duplicate_layer.status = 'active'
            and duplicate_layer.layer_number = layer.layer_number
       ) <> 1
  )
  or exists (
    select 1
      from public.purchase_requisition_approval_layers layer
      left join public.profiles profile on profile.id = layer.approver_user_id
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
       and (profile.id is null or profile.status <> 'active')
  ) then
    raise exception 'Indent approval workflow is not configured for this site.';
  end if;

  select count(*) into active_line_count
    from public.purchase_requisition_items
   where requisition_id = requisition_row.id;
  if active_line_count = 0 then
    raise exception 'At least one material line is required.';
  end if;

  if exists (
    select 1 from public.purchase_requisition_items
     where requisition_id = requisition_row.id
       and line_key is null
  ) or exists (
    select 1
      from public.purchase_requisition_items
     where requisition_id = requisition_row.id
     group by line_key
    having count(*) > 1
  ) then
    raise exception 'Requisition material line identity is invalid.';
  end if;
  if exists (
    select 1 from public.purchase_requisition_items
     where requisition_id = requisition_row.id
       and nullif(trim(purpose), '') is null
  ) then
    raise exception 'Purpose / Requirement is required for every material line.';
  end if;

  select coalesce(max(existing_step.submission_cycle), 0) + 1 into next_submission_cycle
    from public.purchase_requisition_approval_steps existing_step
   where existing_step.requisition_id = requisition_row.id;

  update public.purchase_requisition_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle < next_submission_cycle
     and status = 'pending';

  update public.purchase_requisition_line_approval_steps
     set status = 'superseded', updated_at = now()
   where requisition_id = requisition_row.id
     and submission_cycle < next_submission_cycle
     and status = 'pending';

  for configured_layer in
    select layer.* from public.purchase_requisition_approval_layers layer
     where layer.configuration_id = configuration_row.id
       and layer.workflow_version = configuration_row.workflow_version
       and layer.status = 'active'
     order by layer.layer_number
  loop
    insert into public.purchase_requisition_approval_steps (
      requisition_id, workflow_version, submission_cycle, layer_number, stage_name,
      approver_user_id, approver_name_snapshot, approver_email_snapshot, status
    )
    select requisition_row.id, configuration_row.workflow_version, next_submission_cycle,
           configured_layer.layer_number, configured_layer.stage_name,
           configured_layer.approver_user_id, profile.full_name, profile.email, 'pending'
      from public.profiles profile
     where profile.id = configured_layer.approver_user_id
       and profile.status = 'active';
    if not found then
      raise exception 'Indent approval workflow is not configured for this site.';
    end if;
  end loop;

  if (
    select count(*) from public.purchase_requisition_approval_steps
     where requisition_id = requisition_row.id and submission_cycle = next_submission_cycle
  ) <> configuration_row.layer_count
  or exists (
    select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
     where not exists (
       select 1 from public.purchase_requisition_approval_steps step
        where step.requisition_id = requisition_row.id
          and step.submission_cycle = next_submission_cycle
          and step.layer_number = expected.layer_number
          and step.status = 'pending'
     )
  ) then
    raise exception 'Indent approval workflow snapshot could not be created.';
  end if;

  -- Removed logical lines retain history but no longer have current state.
  update public.purchase_requisition_line_approval_state state
     set approval_status = 'superseded', current_approval_layer = null,
         updated_at = now()
   where state.requisition_id = requisition_row.id
     and not exists (
       select 1 from public.purchase_requisition_items item
        where item.requisition_id = requisition_row.id
          and item.line_key = state.requisition_item_line_key
     );

  for current_item in
    select item.* from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
     order by item.line_key
  loop
    insert into public.purchase_requisition_line_approval_state (
      requisition_id, requisition_item_line_key, workflow_version, submission_cycle,
      current_approval_layer, approval_status, final_approved_at,
      final_approved_by, final_approved_by_name, updated_at
    ) values (
      requisition_row.id, current_item.line_key, configuration_row.workflow_version,
      next_submission_cycle, 1, 'pending', null, null, null, now()
    )
    on conflict (requisition_id, requisition_item_line_key)
    do update set workflow_version = excluded.workflow_version,
                  submission_cycle = excluded.submission_cycle,
                  current_approval_layer = excluded.current_approval_layer,
                  approval_status = excluded.approval_status,
                  final_approved_at = null,
                  final_approved_by = null,
                  final_approved_by_name = null,
                  updated_at = now();

    for configured_layer in
      select layer.* from public.purchase_requisition_approval_layers layer
       where layer.configuration_id = configuration_row.id
         and layer.workflow_version = configuration_row.workflow_version
         and layer.status = 'active'
       order by layer.layer_number
    loop
      insert into public.purchase_requisition_line_approval_steps (
        requisition_id, requisition_item_line_key, workflow_version, submission_cycle,
        layer_number, stage_name, approver_user_id, approver_name_snapshot,
        approver_email_snapshot, status
      )
      select requisition_row.id, current_item.line_key, configuration_row.workflow_version,
             next_submission_cycle, configured_layer.layer_number, configured_layer.stage_name,
             configured_layer.approver_user_id, profile.full_name, profile.email, 'pending'
        from public.profiles profile
       where profile.id = configured_layer.approver_user_id
         and profile.status = 'active';
      if not found then
        raise exception 'Indent line approval workflow snapshot could not be created.';
      end if;
    end loop;
  end loop;

  if (
    select count(*) from public.purchase_requisition_line_approval_state
     where requisition_id = requisition_row.id
       and submission_cycle = next_submission_cycle
       and approval_status = 'pending'
       and current_approval_layer = 1
  ) <> active_line_count
  or (
    select count(*) from public.purchase_requisition_line_approval_steps
     where requisition_id = requisition_row.id
       and submission_cycle = next_submission_cycle
  ) <> active_line_count * configuration_row.layer_count
  or exists (
    select 1 from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and exists (
         select 1 from generate_series(1, configuration_row.layer_count) expected(layer_number)
          where not exists (
            select 1 from public.purchase_requisition_line_approval_steps step
             where step.requisition_id = requisition_row.id
               and step.requisition_item_line_key = item.line_key
               and step.submission_cycle = next_submission_cycle
               and step.layer_number = expected.layer_number
               and step.status = 'pending'
          )
       )
  ) then
    raise exception 'Indent line approval workflow snapshot could not be created.';
  end if;

  update public.purchase_requisitions
     set status = 'pending_approval', approval_status = 'pending',
         current_approval_layer = 1,
         approval_workflow_version = configuration_row.workflow_version,
         submitted_at = now(), submitted_by = actor_id,
         submitted_by_name = actor_name, submitted_by_email = actor_email,
         sent_back_reason = null, updated_by = actor_id,
         updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id,
    case when requisition_row.status = 'sent_back' then 'resubmitted' else 'submitted' end,
    'Submitted for approval.', requisition_row.status, 'pending_approval',
    actor_id, actor_name, actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'submission_cycle', next_submission_cycle,
    'workflow_version', configuration_row.workflow_version
  );
end;
$$;

revoke all on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_purchase_requisition_for_approval_atomic(uuid, jsonb)
  to service_role;
create or replace function public.edit_purchase_requisition_lines_during_approval_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_lines jsonb,
  p_actor jsonb,
  p_event_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  line_state public.purchase_requisition_line_approval_state%rowtype;
  line_step public.purchase_requisition_line_approval_steps%rowtype;
  item_row public.purchase_requisition_items%rowtype;
  item_master public.procurement_items%rowtype;
  uom_row public.procurement_uoms%rowtype;
  item_json jsonb;
  make_json jsonb;
  selected_line_keys uuid[];
  selected_line_key uuid;
  actor_id uuid := nullif(p_actor ->> 'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor ->> 'name'), '');
  actor_email text := nullif(trim(p_actor ->> 'email'), '');
  requested_count integer;
  distinct_count integer;
  line_index integer := 0;
  requested_uom_id uuid;
  requested_item_id uuid;
  requested_employee_id uuid;
  quantity_value numeric;
  requested_by_name text;
  required_by_value date;
  minimum_required_by date;
  updated_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if p_requisition_id is null or p_organization_id is null then
    raise exception 'Requisition scope is required.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one material line is required.';
  end if;

  begin
    select count(*), count(distinct (value ->> 'line_key')::uuid),
           array_agg((value ->> 'line_key')::uuid order by (value ->> 'line_key')::uuid)
      into requested_count, distinct_count, selected_line_keys
      from jsonb_array_elements(p_lines);
  exception when invalid_text_representation then
    raise exception 'Selected material line identity is invalid.';
  end;
  if requested_count <> distinct_count then
    raise exception 'Duplicate material lines are not allowed.';
  end if;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
     and organization_id = p_organization_id;
  if not found or requisition_row.status = 'deleted' then
    raise exception 'Requisition was not found.';
  end if;
  if requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Only Pending Approval requisitions can be edited by the current approver.';
  end if;

  -- Validate and lock all selected logical lines in deterministic line-key order.
  foreach selected_line_key in array selected_line_keys loop
    if not exists (
      select 1 from public.purchase_requisition_items item
       where item.requisition_id = requisition_row.id
         and item.line_key = selected_line_key
    ) then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    select * into line_state
      from public.purchase_requisition_line_approval_state state
     where state.requisition_id = requisition_row.id
       and state.requisition_item_line_key = selected_line_key
     for update;
    if not found or line_state.approval_status <> 'pending'
       or line_state.current_approval_layer is null then
      raise exception 'One or more selected material lines is no longer pending.';
    end if;

    select * into line_step
      from public.purchase_requisition_line_approval_steps step
     where step.requisition_id = requisition_row.id
       and step.requisition_item_line_key = selected_line_key
       and step.workflow_version = line_state.workflow_version
       and step.submission_cycle = line_state.submission_cycle
       and step.layer_number = line_state.current_approval_layer
     for update;
    if not found or line_step.status <> 'pending' then
      raise exception 'One or more selected material lines has no pending current approval step.';
    end if;
    if line_step.approver_user_id <> actor_id then
      raise exception 'You are not the assigned approver for one or more selected material lines.';
    end if;

    select * into item_row
      from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and item.line_key = selected_line_key
     for update;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;
  end loop;

  -- Validate every submitted value before changing any selected line.
  for item_json in select value from jsonb_array_elements(p_lines) loop
    line_index := line_index + 1;
    requested_item_id := nullif(item_json ->> 'item_id', '')::uuid;
    requested_uom_id := nullif(item_json ->> 'uom_id', '')::uuid;
    requested_employee_id := nullif(item_json ->> 'requested_by_employee_id', '')::uuid;
    quantity_value := (item_json ->> 'quantity')::numeric;

    if nullif(trim(item_json ->> 'required_by_date'), '') is null then
      raise exception 'Required by date is required for every material line.';
    end if;
    if nullif(trim(item_json ->> 'purpose'), '') is null then
      raise exception 'Purpose / Requirement is required for every material line.';
    end if;
    begin
      required_by_value := (item_json ->> 'required_by_date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'Required by date is invalid on line %.', line_index;
    end;
    if item_json ? 'approved_makes'
       and item_json -> 'approved_makes' <> 'null'::jsonb
       and jsonb_typeof(item_json -> 'approved_makes') <> 'array' then
      raise exception 'Approved makes must be an array on line %.', line_index;
    end if;
    if requested_item_id is null or requested_employee_id is null then
      raise exception 'Item and Requested By are required on line %.', line_index;
    end if;
    select * into item_master
      from public.procurement_items item
     where item.id = requested_item_id
       and item.organization_id = requisition_row.organization_id
       and item.status = 'active';
    if not found then
      raise exception 'Active item was not found on line %.', line_index;
    end if;
    if item_master.default_uom_id is null
       or (requested_uom_id is not null and requested_uom_id <> item_master.default_uom_id) then
      raise exception 'Selected UOM does not match the Item Master on line %.', line_index;
    end if;
    select * into uom_row
      from public.procurement_uoms uom
     where uom.id = item_master.default_uom_id
       and uom.organization_id = requisition_row.organization_id
       and uom.status = 'active';
    if not found then
      raise exception 'Active UOM was not found on line %.', line_index;
    end if;
    if quantity_value is null or quantity_value <= 0 then
      raise exception 'Quantity must be greater than 0 on line %.', line_index;
    end if;
    select employee.employee_name into requested_by_name
      from public.hr_employees employee
     where employee.id = requested_employee_id
       and employee.organization_id = requisition_row.organization_id
       and employee.status = 'active'
       and (
         employee.site_id = requisition_row.site_id
         or exists (
           select 1 from public.sites head_office
            where head_office.id = employee.site_id
              and head_office.organization_id = employee.organization_id
              and head_office.status = 'active'
              and head_office.site_code = 'HO'
         )
       );
    if not found then
      raise exception 'Requested-by employee is invalid on line %.', line_index;
    end if;
  end loop;

  -- Update selected physical rows in place, preserving line_key and attachment ownership.
  line_index := 0;
  for item_json in select value from jsonb_array_elements(p_lines) loop
    line_index := line_index + 1;
    selected_line_key := (item_json ->> 'line_key')::uuid;
    requested_item_id := nullif(item_json ->> 'item_id', '')::uuid;
    requested_uom_id := nullif(item_json ->> 'uom_id', '')::uuid;
    requested_employee_id := nullif(item_json ->> 'requested_by_employee_id', '')::uuid;
    quantity_value := (item_json ->> 'quantity')::numeric;
    required_by_value := (item_json ->> 'required_by_date')::date;

    select * into item_master
      from public.procurement_items item
     where item.id = requested_item_id
       and item.organization_id = requisition_row.organization_id
       and item.status = 'active';
    select * into uom_row
      from public.procurement_uoms uom
     where uom.id = item_master.default_uom_id
       and uom.organization_id = requisition_row.organization_id
       and uom.status = 'active';
    select employee.employee_name into requested_by_name
      from public.hr_employees employee
     where employee.id = requested_employee_id
       and employee.organization_id = requisition_row.organization_id
       and employee.status = 'active'
       and (employee.site_id = requisition_row.site_id or exists (
         select 1 from public.sites head_office
          where head_office.id = employee.site_id
            and head_office.organization_id = employee.organization_id
            and head_office.status = 'active'
            and head_office.site_code = 'HO'
       ));

    select * into item_row
      from public.purchase_requisition_items item
     where item.requisition_id = requisition_row.id
       and item.line_key = selected_line_key
     for update;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    update public.purchase_requisition_items
       set item_id = item_master.id,
           item_name_snapshot = item_master.item_name,
           item_code_snapshot = item_master.item_code,
           specification = nullif(item_json ->> 'specification', ''),
           purpose = nullif(trim(item_json ->> 'purpose'), ''),
           make_brand = nullif(item_json ->> 'make_brand', ''),
           uom_id = uom_row.id,
           uom_snapshot = uom_row.uom_code,
           quantity = quantity_value,
           required_by_date = required_by_value,
           requested_by_employee_id = requested_employee_id,
           requested_by_name_snapshot = requested_by_name,
           remarks = nullif(item_json ->> 'remarks', ''),
           updated_at = now()
     where requisition_id = requisition_row.id
       and line_key = selected_line_key;
    if not found then
      raise exception 'One or more selected material lines is no longer part of this Indent.';
    end if;

    delete from public.purchase_requisition_item_approved_makes makes
     where makes.requisition_item_id = item_row.id;
    if jsonb_typeof(item_json -> 'approved_makes') = 'array' then
      for make_json in select value from jsonb_array_elements(item_json -> 'approved_makes') loop
        if nullif(trim(make_json #>> '{}'), '') is not null then
          insert into public.purchase_requisition_item_approved_makes (
            requisition_item_id, make_name_snapshot, sort_order
          ) values (
            item_row.id, trim(make_json #>> '{}'),
            (select count(*) + 1 from public.purchase_requisition_item_approved_makes
              where requisition_item_id = item_row.id)
          );
        end if;
      end loop;
    end if;
    updated_count := updated_count + 1;
  end loop;

  -- Recompute the legacy header date from every current line, not only selected lines.
  select min(item.required_by_date) into minimum_required_by
    from public.purchase_requisition_items item
   where item.requisition_id = requisition_row.id;

  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id
   for update;
  if not found or requisition_row.status <> 'pending_approval'
     or requisition_row.approval_status <> 'pending' then
    raise exception 'Requisition is no longer pending approval.';
  end if;
  update public.purchase_requisitions
     set required_by_date = minimum_required_by,
         updated_by = actor_id, updated_by_name = actor_name,
         updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;

  insert into public.purchase_requisition_events (
    requisition_id, event_type, event_note, from_status, to_status,
    created_by, created_by_name, created_by_email
  ) values (
    requisition_row.id, 'line_edited_during_approval',
    coalesce(nullif(trim(p_event_note), ''),
      'Edited ' || updated_count || ' material line' || case when updated_count = 1 then '' else 's' end
      || ' during approval.'), requisition_row.status, requisition_row.status,
    actor_id, actor_name, actor_email
  );

  return jsonb_build_object(
    'requisition_id', requisition_row.id,
    'updated_line_count', updated_count,
    'submission_cycle', (select max(state.submission_cycle)
      from public.purchase_requisition_line_approval_state state
     where state.requisition_id = requisition_row.id)
  );
end;
$$;

revoke all on function public.edit_purchase_requisition_lines_during_approval_atomic(uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.edit_purchase_requisition_lines_during_approval_atomic(uuid, uuid, jsonb, jsonb, text)
  to service_role;
