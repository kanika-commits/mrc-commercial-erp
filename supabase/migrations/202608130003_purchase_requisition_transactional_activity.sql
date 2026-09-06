-- Transactional Purchase Requisition / Indent activity hardening.
-- Uses 202608120019_procurement_requisition_line_purpose.sql as the authoritative RPC baseline.

begin;

create or replace function public.purchase_requisition_activity_line_snapshot(
  p_line jsonb,
  p_approved_makes jsonb default '[]'::jsonb
) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'item', jsonb_strip_nulls(jsonb_build_object(
      'id', nullif(p_line->>'item_id', ''),
      'code', nullif(coalesce(p_line->>'item_code_snapshot', p_line->>'item_code'), ''),
      'name', nullif(coalesce(p_line->>'item_name_snapshot', p_line->>'item_name'), '')
    )),
    'specification', nullif(p_line->>'specification', ''),
    'purpose', nullif(p_line->>'purpose', ''),
    'quantity', case when nullif(p_line->>'quantity', '') is null then null else to_jsonb((p_line->>'quantity')::numeric) end,
    'uom', jsonb_strip_nulls(jsonb_build_object(
      'id', nullif(p_line->>'uom_id', ''),
      'name', nullif(coalesce(p_line->>'uom_snapshot', p_line->>'uom_code'), '')
    )),
    'requested_by', jsonb_strip_nulls(jsonb_build_object(
      'id', nullif(p_line->>'requested_by_employee_id', ''),
      'name', nullif(p_line->>'requested_by_name_snapshot', '')
    )),
    'required_by_date', nullif(p_line->>'required_by_date', ''),
    'approved_makes', coalesce(p_approved_makes, '[]'::jsonb),
    'remarks', nullif(p_line->>'remarks', '')
  ));
$$;

create or replace function public.purchase_requisition_activity_line_changes(
  p_before jsonb,
  p_after jsonb,
  p_before_makes jsonb default '[]'::jsonb,
  p_after_makes jsonb default '[]'::jsonb
) returns jsonb language plpgsql immutable as $$
declare
  changes jsonb := '{}'::jsonb;
  field text;
  before_value jsonb;
  after_value jsonb;
  added jsonb;
  removed jsonb;
begin
  foreach field in array array['item','specification','purpose','quantity','uom','requested_by','required_by_date','remarks'] loop
    before_value := coalesce(public.purchase_requisition_activity_line_snapshot(p_before, p_before_makes)->field, 'null'::jsonb);
    after_value := coalesce(public.purchase_requisition_activity_line_snapshot(p_after, p_after_makes)->field, 'null'::jsonb);
    if before_value <> after_value then
      changes := changes || jsonb_build_object(field, jsonb_build_object('old', before_value, 'new', after_value));
    end if;
  end loop;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into added
    from jsonb_array_elements_text(coalesce(p_after_makes, '[]'::jsonb)) after_make(value)
   where not exists (select 1 from jsonb_array_elements_text(coalesce(p_before_makes, '[]'::jsonb)) before_make(value) where lower(before_make.value) = lower(after_make.value));
  select coalesce(jsonb_agg(value), '[]'::jsonb) into removed
    from jsonb_array_elements_text(coalesce(p_before_makes, '[]'::jsonb)) before_make(value)
   where not exists (select 1 from jsonb_array_elements_text(coalesce(p_after_makes, '[]'::jsonb)) after_make(value) where lower(after_make.value) = lower(before_make.value));
  if jsonb_array_length(added) > 0 or jsonb_array_length(removed) > 0 then
    changes := changes || jsonb_build_object('approved_makes', jsonb_build_object('added', added, 'removed', removed));
  end if;
  return nullif(changes, '{}'::jsonb);
end;
$$;

create or replace function public.insert_purchase_requisition_activity_event(
  p_requisition public.purchase_requisitions,
  p_action_type text,
  p_actor jsonb,
  p_line jsonb default null,
  p_changes jsonb default null,
  p_workflow_version integer default null,
  p_approval_cycle integer default null,
  p_approval_layer integer default null,
  p_approval_stage_name text default null,
  p_note text default null
) returns uuid language plpgsql set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.purchase_requisition_activity_events (
    organization_id, company_id, site_id, requisition_id, requisition_number_snapshot,
    line_key, item_id_snapshot, item_code_snapshot, item_name_snapshot, action_type, changes,
    actor_user_id, actor_name, actor_email, workflow_version, approval_cycle, approval_layer, approval_stage_name, note
  ) values (
    p_requisition.organization_id, p_requisition.company_id, p_requisition.site_id, p_requisition.id, p_requisition.requisition_number,
    nullif(p_line->>'line_key', '')::uuid, nullif(p_line->>'item_id', '')::uuid, nullif(coalesce(p_line->>'item_code_snapshot', p_line->>'item_code'), ''), nullif(coalesce(p_line->>'item_name_snapshot', p_line->>'item_name'), ''), p_action_type, p_changes,
    nullif(p_actor->>'user_id', '')::uuid, nullif(trim(p_actor->>'name'), ''), nullif(trim(p_actor->>'email'), ''), p_workflow_version, p_approval_cycle, p_approval_layer, p_approval_stage_name, p_note
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.purchase_requisition_activity_collect_lines(
  p_requisition_id uuid
) returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('line', line_json, 'makes', makes_json) order by sort_order), '[]'::jsonb)
    from (
      select
        i.sort_order,
        to_jsonb(i) as line_json,
        coalesce((
          select jsonb_agg(m.make_name_snapshot order by m.sort_order)
            from public.purchase_requisition_item_approved_makes m
           where m.requisition_item_id = i.id
        ), '[]'::jsonb) as makes_json
      from public.purchase_requisition_items i
      where i.requisition_id = p_requisition_id
    ) line_rows;
$$;

create or replace function public.purchase_requisition_activity_line_at(
  p_lines jsonb,
  p_line_key uuid
) returns jsonb language sql immutable as $$
  select item
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) item
   where nullif(item->'line'->>'line_key', '')::uuid = p_line_key
   limit 1;
$$;

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
  v_requisition public.purchase_requisitions%rowtype;
  v_line_row public.purchase_requisition_items%rowtype;
  v_line_makes jsonb;
  v_actor jsonb;
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

  select * into v_requisition from public.purchase_requisitions where id = v_id;
  v_actor := jsonb_build_object('user_id', p_event->>'created_by', 'name', p_event->>'created_by_name', 'email', p_event->>'created_by_email');
  perform public.insert_purchase_requisition_activity_event(
    v_requisition, 'requisition_created', v_actor, null,
    jsonb_build_object('lines', public.purchase_requisition_activity_collect_lines(v_id)),
    null, null, null, null, 'Draft created.'
  );
  for v_line_row in select * from public.purchase_requisition_items where requisition_id = v_id order by sort_order loop
    select coalesce(jsonb_agg(m.make_name_snapshot order by m.sort_order), '[]'::jsonb) into v_line_makes
      from public.purchase_requisition_item_approved_makes m where m.requisition_item_id = v_line_row.id;
    perform public.insert_purchase_requisition_activity_event(
      v_requisition, 'line_added', v_actor, to_jsonb(v_line_row),
      public.purchase_requisition_activity_line_snapshot(to_jsonb(v_line_row), v_line_makes),
      null, null, null, null, null
    );
  end loop;
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
  v_before_lines jsonb;
  v_after_lines jsonb;
  v_before_entry jsonb;
  v_after_entry jsonb;
  v_changes jsonb;
  v_actor jsonb;
  v_document record;
  v_document_line jsonb;
begin
  select * into v_requisition
    from public.purchase_requisitions
   where id = p_requisition_id and organization_id = p_organization_id
   for update;
  if not found or v_requisition.status not in ('draft','sent_back') then raise exception 'Requisition is not editable.'; end if;
  v_before_lines := public.purchase_requisition_activity_collect_lines(p_requisition_id);
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
  v_actor := jsonb_build_object('user_id', p_event->>'created_by', 'name', p_event->>'created_by_name', 'email', p_event->>'created_by_email');
  for v_document in
    select *
      from public.purchase_requisition_documents document
     where document.requisition_id = p_requisition_id
       and document.status = 'active'
       and document.requisition_item_line_key is not null
       and not exists (
         select 1
           from jsonb_array_elements(p_items) submitted
          where nullif(submitted.value->>'line_key', '')::uuid = document.requisition_item_line_key
       )
  loop
    v_document_line := public.purchase_requisition_activity_line_at(v_before_lines, v_document.requisition_item_line_key);
    perform public.insert_purchase_requisition_activity_event(
      v_requisition,
      'attachment_removed',
      v_actor,
      case when v_document_line is null then jsonb_build_object('line_key', v_document.requisition_item_line_key) else v_document_line->'line' end,
      jsonb_build_object(
        'document',
        jsonb_build_object('id', v_document.id, 'file_name', v_document.original_file_name, 'mime_type', v_document.mime_type, 'size_bytes', v_document.size_bytes, 'line_key', v_document.requisition_item_line_key),
        'reason',
        'Removed because material line was removed.'
      ),
      null, null, null, null, 'Removed because material line was removed.'
    );
  end loop;
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

  select * into v_requisition from public.purchase_requisitions where id = p_requisition_id;
  v_after_lines := public.purchase_requisition_activity_collect_lines(p_requisition_id);

  for v_before_entry in select value from jsonb_array_elements(v_before_lines) loop
    v_after_entry := public.purchase_requisition_activity_line_at(v_after_lines, nullif(v_before_entry->'line'->>'line_key', '')::uuid);
    if v_after_entry is null then
      perform public.insert_purchase_requisition_activity_event(
        v_requisition, 'line_removed', v_actor, v_before_entry->'line',
        public.purchase_requisition_activity_line_snapshot(v_before_entry->'line', v_before_entry->'makes'),
        null, null, null, null, null
      );
    else
      v_changes := public.purchase_requisition_activity_line_changes(v_before_entry->'line', v_after_entry->'line', v_before_entry->'makes', v_after_entry->'makes');
      if v_changes is not null then
        perform public.insert_purchase_requisition_activity_event(v_requisition, 'line_edited', v_actor, v_after_entry->'line', v_changes, null, null, null, null, null);
      end if;
    end if;
  end loop;

  for v_after_entry in select value from jsonb_array_elements(v_after_lines) loop
    v_before_entry := public.purchase_requisition_activity_line_at(v_before_lines, nullif(v_after_entry->'line'->>'line_key', '')::uuid);
    if v_before_entry is null then
      perform public.insert_purchase_requisition_activity_event(
        v_requisition, 'line_added', v_actor, v_after_entry->'line',
        public.purchase_requisition_activity_line_snapshot(v_after_entry->'line', v_after_entry->'makes'),
        null, null, null, null, null
      );
    end if;
  end loop;
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
  before_lines jsonb;
  after_lines jsonb;
  before_entry jsonb;
  after_entry jsonb;
  line_changes jsonb;
  document_entry record;
  document_line jsonb;
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
  before_lines := public.purchase_requisition_activity_collect_lines(requisition_row.id);
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
  for document_entry in
    select *
      from public.purchase_requisition_documents document
     where document.requisition_id = requisition_row.id
       and document.status = 'active'
       and document.requisition_item_line_key is not null
       and not exists (
         select 1
           from jsonb_array_elements(p_items) submitted
          where nullif(submitted.value->>'line_key', '')::uuid = document.requisition_item_line_key
       )
  loop
    document_line := public.purchase_requisition_activity_line_at(before_lines, document_entry.requisition_item_line_key);
    perform public.insert_purchase_requisition_activity_event(
      requisition_row,
      'attachment_removed',
      p_actor,
      case when document_line is null then jsonb_build_object('line_key', document_entry.requisition_item_line_key) else document_line->'line' end,
      jsonb_build_object(
        'document',
        jsonb_build_object('id', document_entry.id, 'file_name', document_entry.original_file_name, 'mime_type', document_entry.mime_type, 'size_bytes', document_entry.size_bytes, 'line_key', document_entry.requisition_item_line_key),
        'reason',
        'Removed because material line was removed.'
      ),
      requisition_row.approval_workflow_version, latest_cycle, current_step.layer_number, current_step.stage_name, 'Removed because material line was removed.'
    );
  end loop;
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

  select * into requisition_row from public.purchase_requisitions where id = p_requisition_id;
  after_lines := public.purchase_requisition_activity_collect_lines(requisition_row.id);
  for before_entry in select value from jsonb_array_elements(before_lines) loop
    after_entry := public.purchase_requisition_activity_line_at(after_lines, nullif(before_entry->'line'->>'line_key', '')::uuid);
    if after_entry is null then
      perform public.insert_purchase_requisition_activity_event(requisition_row, 'line_removed', p_actor, before_entry->'line', public.purchase_requisition_activity_line_snapshot(before_entry->'line', before_entry->'makes'), requisition_row.approval_workflow_version, latest_cycle, current_step.layer_number, current_step.stage_name, 'Removed during approval edit.');
    else
      line_changes := public.purchase_requisition_activity_line_changes(before_entry->'line', after_entry->'line', before_entry->'makes', after_entry->'makes');
      if line_changes is not null then
        perform public.insert_purchase_requisition_activity_event(requisition_row, 'approval_line_edited', p_actor, after_entry->'line', line_changes, requisition_row.approval_workflow_version, latest_cycle, current_step.layer_number, current_step.stage_name, 'Edited during approval.');
      end if;
    end if;
  end loop;
  for after_entry in select value from jsonb_array_elements(after_lines) loop
    before_entry := public.purchase_requisition_activity_line_at(before_lines, nullif(after_entry->'line'->>'line_key', '')::uuid);
    if before_entry is null then
      perform public.insert_purchase_requisition_activity_event(requisition_row, 'line_added', p_actor, after_entry->'line', public.purchase_requisition_activity_line_snapshot(after_entry->'line', after_entry->'makes'), requisition_row.approval_workflow_version, latest_cycle, current_step.layer_number, current_step.stage_name, 'Added during approval edit.');
    end if;
  end loop;
  return jsonb_build_object('requisition_id', requisition_row.id, 'layer_number', current_step.layer_number, 'submission_cycle', latest_cycle);
end; $$;

revoke all on function public.purchase_requisition_activity_line_snapshot(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.purchase_requisition_activity_line_changes(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.insert_purchase_requisition_activity_event(public.purchase_requisitions, text, jsonb, jsonb, jsonb, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.purchase_requisition_activity_collect_lines(uuid) from public, anon, authenticated;
revoke all on function public.purchase_requisition_activity_line_at(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.purchase_requisition_activity_line_snapshot(jsonb, jsonb) to service_role;
grant execute on function public.purchase_requisition_activity_line_changes(jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.insert_purchase_requisition_activity_event(public.purchase_requisitions, text, jsonb, jsonb, jsonb, integer, integer, integer, text, text) to service_role;
grant execute on function public.purchase_requisition_activity_collect_lines(uuid) to service_role;
grant execute on function public.purchase_requisition_activity_line_at(jsonb, uuid) to service_role;

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
  first_stage_name text;
  original_status text;
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
  original_status := requisition_row.status;

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

  select stage_name into first_stage_name
    from public.purchase_requisition_approval_steps
   where requisition_id = requisition_row.id
     and submission_cycle = next_submission_cycle
     and layer_number = 1
   limit 1;
  select * into requisition_row from public.purchase_requisitions where id = p_requisition_id;
  perform public.insert_purchase_requisition_activity_event(
    requisition_row,
    case when original_status = 'sent_back' then 'requisition_resubmitted' else 'requisition_submitted' end,
    p_actor,
    null,
    null,
    configuration_row.workflow_version,
    next_submission_cycle,
    1,
    first_stage_name,
    case when original_status = 'sent_back' then 'Resubmitted for approval.' else 'Submitted for approval.' end
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
  before_lines jsonb;
  after_lines jsonb;
  before_entry jsonb;
  after_entry jsonb;
  line_changes jsonb;
  activity_cycle integer;
  activity_layer integer;
  activity_stage text;
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

  before_lines := public.purchase_requisition_activity_collect_lines(requisition_row.id);

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

  after_lines := public.purchase_requisition_activity_collect_lines(requisition_row.id);
  foreach selected_line_key in array selected_line_keys loop
    before_entry := public.purchase_requisition_activity_line_at(before_lines, selected_line_key);
    after_entry := public.purchase_requisition_activity_line_at(after_lines, selected_line_key);
    select state.submission_cycle, state.current_approval_layer, step.stage_name
      into activity_cycle, activity_layer, activity_stage
      from public.purchase_requisition_line_approval_state state
      join public.purchase_requisition_line_approval_steps step
        on step.requisition_id = state.requisition_id
       and step.requisition_item_line_key = state.requisition_item_line_key
       and step.workflow_version = state.workflow_version
       and step.submission_cycle = state.submission_cycle
       and step.layer_number = state.current_approval_layer
     where state.requisition_id = requisition_row.id
       and state.requisition_item_line_key = selected_line_key;
    line_changes := public.purchase_requisition_activity_line_changes(before_entry->'line', after_entry->'line', before_entry->'makes', after_entry->'makes');
    if line_changes is not null then
      perform public.insert_purchase_requisition_activity_event(requisition_row, 'approval_line_edited', p_actor, after_entry->'line', line_changes, requisition_row.approval_workflow_version, activity_cycle, activity_layer, activity_stage, 'Edited during approval.');
    end if;
  end loop;

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

create or replace function public.delete_purchase_requisition_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_actor jsonb,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor->>'name'), '');
  actor_email text := nullif(trim(p_actor->>'email'), '');
  reason_text text := nullif(trim(p_reason), '');
  rfq_count integer;
  rfq_item_count integer;
begin
  if actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  if reason_text is null or length(reason_text) < 10 then raise exception 'Deletion reason must be at least 10 characters.'; end if;
  select * into requisition_row
    from public.purchase_requisitions
   where id = p_requisition_id and organization_id = p_organization_id and status <> 'deleted'
   for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if requisition_row.status = 'approved' and exists (
    select 1 from public.procurement_rfqs rfq where rfq.source_requisition_id = requisition_row.id
  ) then raise exception 'This Indent cannot be deleted because procurement has already started.'; end if;
  if requisition_row.status not in ('draft','pending_approval','sent_back','rejected','approved') then
    raise exception 'This Indent status cannot be deleted.';
  end if;
  select count(*) into rfq_count from public.procurement_rfqs where source_requisition_id = requisition_row.id;
  select count(*) into rfq_item_count from public.procurement_rfq_items where source_requisition_id = requisition_row.id;
  if coalesce(rfq_count, 0) > 0 or coalesce(rfq_item_count, 0) > 0 then
    raise exception 'This Indent cannot be deleted because procurement has already started.';
  end if;

  update public.purchase_requisition_approval_steps
     set status = 'superseded', action_note = reason_text, updated_at = now()
   where requisition_id = requisition_row.id and status = 'pending';
  update public.purchase_requisition_line_approval_steps
     set status = 'superseded', action_note = reason_text, updated_at = now()
   where requisition_id = requisition_row.id and status = 'pending';
  update public.purchase_requisition_line_approval_state
     set approval_status = 'superseded', current_approval_layer = null, updated_at = now()
   where requisition_id = requisition_row.id and approval_status = 'pending';
  update public.purchase_requisitions
     set status = 'deleted', approval_status = 'draft', updated_by = actor_id,
         updated_by_name = actor_name, updated_by_email = actor_email, updated_at = now()
   where id = requisition_row.id;
  insert into public.purchase_requisition_events(requisition_id,event_type,event_note,from_status,to_status,created_by,created_by_name,created_by_email)
  values(requisition_row.id,'deleted',reason_text,requisition_row.status,'deleted',actor_id,actor_name,actor_email);
  perform public.insert_purchase_requisition_activity_event(
    requisition_row, 'requisition_deleted', p_actor, null,
    jsonb_build_object('original_status', requisition_row.status), null, null, null, null, reason_text
  );
  return jsonb_build_object('ok', true, 'requisition_id', requisition_row.id, 'status', 'deleted');
end;
$$;

create or replace function public.add_purchase_requisition_document_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_document jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  document_row public.purchase_requisition_documents%rowtype;
  actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  actor_name text := nullif(trim(p_actor->>'name'), '');
  actor_email text := nullif(trim(p_actor->>'email'), '');
  document_line_key uuid := nullif(p_document->>'requisition_item_line_key', '')::uuid;
begin
  if actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  select * into requisition_row from public.purchase_requisitions where id = p_requisition_id and organization_id = p_organization_id and status <> 'deleted' for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  if document_line_key is not null and not exists (select 1 from public.purchase_requisition_items where requisition_id = requisition_row.id and line_key = document_line_key) then
    raise exception 'Material line was not found on this requisition.';
  end if;
  insert into public.purchase_requisition_documents(
    organization_id, requisition_id, requisition_item_line_key, storage_provider, storage_bucket, storage_key,
    original_file_name, mime_type, size_bytes, checksum, uploaded_by, uploaded_by_name, uploaded_by_email
  ) values (
    requisition_row.organization_id, requisition_row.id, document_line_key, p_document->>'storage_provider', p_document->>'storage_bucket', p_document->>'storage_key',
    p_document->>'original_file_name', p_document->>'mime_type', nullif(p_document->>'size_bytes','')::bigint, p_document->>'checksum', actor_id, actor_name, actor_email
  ) returning * into document_row;
  perform public.insert_purchase_requisition_activity_event(
    requisition_row, 'attachment_uploaded', p_actor,
    case when document_line_key is null then null else jsonb_build_object('line_key', document_line_key) end,
    jsonb_build_object('document', jsonb_build_object('id', document_row.id, 'file_name', document_row.original_file_name, 'mime_type', document_row.mime_type, 'size_bytes', document_row.size_bytes, 'line_key', document_row.requisition_item_line_key)),
    null, null, null, null, null
  );
  return to_jsonb(document_row);
end;
$$;

create or replace function public.remove_purchase_requisition_document_atomic(
  p_requisition_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requisition_row public.purchase_requisitions%rowtype;
  document_row public.purchase_requisition_documents%rowtype;
  actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
begin
  if actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  select * into requisition_row from public.purchase_requisitions where id = p_requisition_id and organization_id = p_organization_id and status <> 'deleted' for update;
  if not found then raise exception 'Requisition was not found.'; end if;
  select * into document_row from public.purchase_requisition_documents where id = p_document_id and requisition_id = requisition_row.id and status = 'active' for update;
  if not found then raise exception 'Attachment was not found.'; end if;
  update public.purchase_requisition_documents set status = 'deleted', updated_at = now() where id = document_row.id;
  perform public.insert_purchase_requisition_activity_event(
    requisition_row, 'attachment_removed', p_actor,
    case when document_row.requisition_item_line_key is null then null else jsonb_build_object('line_key', document_row.requisition_item_line_key) end,
    jsonb_build_object('document', jsonb_build_object('id', document_row.id, 'file_name', document_row.original_file_name, 'mime_type', document_row.mime_type, 'size_bytes', document_row.size_bytes, 'line_key', document_row.requisition_item_line_key)),
    null, null, null, null, null
  );
  return to_jsonb(document_row);
end;
$$;

revoke all on function public.delete_purchase_requisition_atomic(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.add_purchase_requisition_document_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.remove_purchase_requisition_document_atomic(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.delete_purchase_requisition_atomic(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.add_purchase_requisition_document_atomic(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.remove_purchase_requisition_document_atomic(uuid, uuid, uuid, jsonb) to service_role;

commit;
