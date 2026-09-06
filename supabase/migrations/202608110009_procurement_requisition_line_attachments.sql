-- Persistent logical line identity for Purchase Requisition material attachments.
-- This migration is intentionally unapplied. Application wiring follows after review.

alter table public.purchase_requisition_items
  add column if not exists line_key uuid;

update public.purchase_requisition_items
   set line_key = gen_random_uuid()
 where line_key is null;

alter table public.purchase_requisition_items
  alter column line_key set default gen_random_uuid(),
  alter column line_key set not null;

create unique index if not exists purchase_requisition_items_line_key_uidx
  on public.purchase_requisition_items (requisition_id, line_key);

alter table public.purchase_requisition_documents
  add column if not exists requisition_item_line_key uuid;

create index if not exists purchase_requisition_documents_line_idx
  on public.purchase_requisition_documents (requisition_id, requisition_item_line_key, status, uploaded_at desc);

create or replace function public.create_purchase_requisition_atomic(
  p_header jsonb, p_items jsonb, p_snapshots jsonb, p_event jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_number text;
  v_item jsonb;
  v_make jsonb;
  v_item_id uuid;
  v_line_key uuid;
  v_line_keys jsonb := '[]'::jsonb;
  v_index integer := 0;
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
    p_header->>'requested_by_name', p_header->>'requested_by_email', (p_header->>'required_by_date')::date,
    p_header->>'priority', p_header->>'purpose', nullif(p_header->>'remarks',''), p_header->>'status',
    p_header->>'approval_status', (p_header->>'submitted_at')::timestamptz, (p_header->>'submitted_by')::uuid,
    p_header->>'submitted_by_name', p_header->>'submitted_by_email', (p_header->>'created_by')::uuid,
    p_header->>'created_by_name', p_header->>'created_by_email';
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_line_key := coalesce(nullif(v_item->>'line_key', '')::uuid, gen_random_uuid());
    insert into public.purchase_requisition_items (
      requisition_id, line_key, item_id, item_name_snapshot, item_code_snapshot, specification, make_brand,
      uom_id, uom_snapshot, quantity, required_by_date, remarks, sort_order
    ) values (
      v_id, v_line_key, (v_item->>'item_id')::uuid, v_item->>'item_name_snapshot', v_item->>'item_code_snapshot',
      nullif(v_item->>'specification',''), nullif(v_item->>'make_brand',''), (v_item->>'uom_id')::uuid,
      v_item->>'uom_snapshot', (v_item->>'quantity')::numeric, nullif(v_item->>'required_by_date','')::date,
      nullif(v_item->>'remarks',''), coalesce((v_item->>'sort_order')::integer,v_index)
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
  v_item jsonb;
  v_make jsonb;
  v_item_id uuid;
  v_line_key uuid;
  v_index integer := 0;
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
  update public.purchase_requisitions set company_id=(p_header->>'company_id')::uuid,site_id=(p_header->>'site_id')::uuid,required_by_date=(p_header->>'required_by_date')::date,requisition_date=(p_header->>'requisition_date')::date,priority=p_header->>'priority',purpose=p_header->>'purpose',remarks=nullif(p_header->>'remarks',''),sent_back_reason=nullif(p_header->>'sent_back_reason',''),updated_by=(p_header->>'updated_by')::uuid,updated_by_name=p_header->>'updated_by_name',updated_by_email=p_header->>'updated_by_email',updated_at=now()
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
    insert into public.purchase_requisition_items(requisition_id,line_key,item_id,item_name_snapshot,item_code_snapshot,specification,make_brand,uom_id,uom_snapshot,quantity,required_by_date,remarks,sort_order)
    values(p_requisition_id,v_line_key,(v_item->>'item_id')::uuid,v_item->>'item_name_snapshot',v_item->>'item_code_snapshot',nullif(v_item->>'specification',''),nullif(v_item->>'make_brand',''),(v_item->>'uom_id')::uuid,v_item->>'uom_snapshot',(v_item->>'quantity')::numeric,nullif(v_item->>'required_by_date','')::date,nullif(v_item->>'remarks',''),coalesce((v_item->>'sort_order')::integer,v_index)) returning id into v_item_id;
    for v_make in select value from jsonb_array_elements(coalesce(p_snapshots->(v_index-1),'[]'::jsonb)) loop
      insert into public.purchase_requisition_item_approved_makes(requisition_item_id,make_name_snapshot,sort_order) values(v_item_id,v_make #>> '{}',1);
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
  update public.purchase_requisitions set requisition_date = coalesce(nullif(p_header->>'requisition_date', '')::date, requisition_row.requisition_date), required_by_date = nullif(p_header->>'required_by_date', '')::date, priority = case when p_header->>'priority' in ('Normal', 'Urgent', 'Critical') then p_header->>'priority' else requisition_row.priority end, purpose = nullif(trim(p_header->>'purpose'), ''), remarks = nullif(p_header->>'remarks', ''), updated_by = actor_id, updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now() where id = requisition_row.id;
  if nullif(trim(p_header->>'purpose'), '') is null or nullif(p_header->>'required_by_date', '') is null then raise exception 'Purpose and required by date are required.'; end if;
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
    select * into item_row from public.procurement_items where id = new_item_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active item was not found on line %.', item_index; end if;
    if item_row.default_uom_id is null or (requested_uom_id is not null and requested_uom_id <> item_row.default_uom_id) then raise exception 'Selected UOM does not match the Item Master on line %.', item_index; end if;
    select * into uom_row from public.procurement_uoms where id = item_row.default_uom_id and organization_id = requisition_row.organization_id and status = 'active';
    if not found then raise exception 'Active UOM was not found on line %.', item_index; end if;
    if quantity_value is null or quantity_value <= 0 then raise exception 'Quantity must be greater than 0 on line %.', item_index; end if;
    insert into public.purchase_requisition_items (requisition_id, line_key, item_id, item_name_snapshot, item_code_snapshot, specification, make_brand, uom_id, uom_snapshot, quantity, required_by_date, remarks, sort_order)
    values (requisition_row.id, line_key_value, item_row.id, item_row.item_name, item_row.item_code, nullif(item_json->>'specification', ''), nullif(item_json->>'make_brand', ''), uom_row.id, uom_row.uom_code, quantity_value, nullif(item_json->>'required_by_date', '')::date, nullif(item_json->>'remarks', ''), item_index)
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
