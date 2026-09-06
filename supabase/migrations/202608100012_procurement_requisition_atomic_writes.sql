create or replace function public.create_purchase_requisition_atomic(
  p_header jsonb, p_items jsonb, p_snapshots jsonb, p_event jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_id uuid := gen_random_uuid(); v_number text; v_item jsonb; v_make jsonb; v_item_id uuid; v_index integer := 0;
begin
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
    insert into public.purchase_requisition_items (
      requisition_id,item_id,item_name_snapshot,item_code_snapshot,specification,make_brand,uom_id,uom_snapshot,quantity,required_by_date,remarks,sort_order
    ) values (v_id,(v_item->>'item_id')::uuid,v_item->>'item_name_snapshot',v_item->>'item_code_snapshot',nullif(v_item->>'specification',''),nullif(v_item->>'make_brand',''),(v_item->>'uom_id')::uuid,v_item->>'uom_snapshot',(v_item->>'quantity')::numeric,nullif(v_item->>'required_by_date','')::date,nullif(v_item->>'remarks',''),coalesce((v_item->>'sort_order')::integer,v_index)) returning id into v_item_id;
    for v_make in select value from jsonb_array_elements(coalesce(p_snapshots->(v_index-1),'[]'::jsonb)) loop
      insert into public.purchase_requisition_item_approved_makes(requisition_item_id,make_name_snapshot,sort_order) values(v_item_id,v_make #>> '{}',1);
    end loop;
  end loop;
  insert into public.purchase_requisition_events(requisition_id,event_type,event_note,from_status,to_status,created_by,created_by_name,created_by_email)
  values(v_id,p_event->>'event_type',p_event->>'event_note',p_event->>'from_status',p_event->>'to_status',(p_event->>'created_by')::uuid,p_event->>'created_by_name',p_event->>'created_by_email');
  return jsonb_build_object('id',v_id,'requisition_number',v_number);
end; $$;

create or replace function public.update_purchase_requisition_atomic(
  p_requisition_id uuid, p_organization_id uuid, p_header jsonb, p_items jsonb, p_snapshots jsonb, p_event jsonb
) returns void language plpgsql set search_path = public as $$
declare
  v_item jsonb; v_make jsonb; v_item_id uuid; v_index integer := 0;
begin
  update public.purchase_requisitions set company_id=(p_header->>'company_id')::uuid,site_id=(p_header->>'site_id')::uuid,required_by_date=(p_header->>'required_by_date')::date,requisition_date=(p_header->>'requisition_date')::date,priority=p_header->>'priority',purpose=p_header->>'purpose',remarks=nullif(p_header->>'remarks',''),sent_back_reason=nullif(p_header->>'sent_back_reason',''),updated_by=(p_header->>'updated_by')::uuid,updated_by_name=p_header->>'updated_by_name',updated_by_email=p_header->>'updated_by_email',updated_at=now()
  where id=p_requisition_id and organization_id=p_organization_id and status in ('draft','sent_back');
  if not found then raise exception 'Requisition is not editable.'; end if;
  delete from public.purchase_requisition_item_approved_makes where requisition_item_id in (select id from public.purchase_requisition_items where requisition_id=p_requisition_id);
  delete from public.purchase_requisition_items where requisition_id=p_requisition_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    insert into public.purchase_requisition_items(requisition_id,item_id,item_name_snapshot,item_code_snapshot,specification,make_brand,uom_id,uom_snapshot,quantity,required_by_date,remarks,sort_order)
    values(p_requisition_id,(v_item->>'item_id')::uuid,v_item->>'item_name_snapshot',v_item->>'item_code_snapshot',nullif(v_item->>'specification',''),nullif(v_item->>'make_brand',''),(v_item->>'uom_id')::uuid,v_item->>'uom_snapshot',(v_item->>'quantity')::numeric,nullif(v_item->>'required_by_date','')::date,nullif(v_item->>'remarks',''),coalesce((v_item->>'sort_order')::integer,v_index)) returning id into v_item_id;
    for v_make in select value from jsonb_array_elements(coalesce(p_snapshots->(v_index-1),'[]'::jsonb)) loop
      insert into public.purchase_requisition_item_approved_makes(requisition_item_id,make_name_snapshot,sort_order) values(v_item_id,v_make #>> '{}',1);
    end loop;
  end loop;
  insert into public.purchase_requisition_events(requisition_id,event_type,event_note,from_status,to_status,created_by,created_by_name,created_by_email) values(p_requisition_id,p_event->>'event_type',p_event->>'event_note',p_event->>'from_status',p_event->>'to_status',(p_event->>'created_by')::uuid,p_event->>'created_by_name',p_event->>'created_by_email');
end; $$;

revoke all on function public.create_purchase_requisition_atomic(jsonb,jsonb,jsonb,jsonb)
from public, anon, authenticated;
revoke all on function public.update_purchase_requisition_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_purchase_requisition_atomic(jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.update_purchase_requisition_atomic(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
