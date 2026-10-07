begin;

-- BASELINE_090016_FUNCTION_SHA256: 7516e3f853613d0a7c7749f9a555b55ea534d761fdd143bdef7e875470cbcdbb
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
  v_previous public.procurement_purchase_orders%rowtype;
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
    if v_po.previous_revision_id is not null then
      select * into v_previous from public.procurement_purchase_orders where id=v_po.previous_revision_id and organization_id=v_po.organization_id for update;
      if not found or v_previous.revision_family_id is distinct from v_po.revision_family_id or v_previous.organization_id is distinct from v_po.organization_id or v_previous.company_id is distinct from v_po.company_id or v_previous.site_id is distinct from v_po.site_id or v_previous.vendor_id is distinct from v_po.vendor_id or v_previous.source_type is distinct from v_po.source_type or v_previous.root_purchase_order_id is distinct from v_po.root_purchase_order_id then raise exception 'Revision identity cannot be changed.'; end if;
      update public.procurement_purchase_orders set revision_diff_snapshot=jsonb_build_object('previous_revision_id',v_previous.id,'current_revision_id',v_po.id,'header',jsonb_build_object('po_date',jsonb_build_object('before',v_previous.po_date,'after',v_po.po_date),'delivery_snapshot',jsonb_build_object('before',v_previous.delivery_snapshot,'after',v_po.delivery_snapshot),'commercial_snapshot',jsonb_build_object('before',v_previous.commercial_snapshot,'after',v_po.commercial_snapshot),'standard_terms_snapshot',jsonb_build_object('before',v_previous.standard_terms_snapshot,'after',v_po.standard_terms_snapshot)),'items',coalesce((select jsonb_agg(jsonb_build_object('type',case when old_i.id is null then 'added' when new_i.id is null then 'removed' when to_jsonb(old_i) is distinct from to_jsonb(new_i) then 'changed' end,'revision_line_key',coalesce(new_i.revision_line_key,old_i.revision_line_key),'before',to_jsonb(old_i),'after',to_jsonb(new_i)) order by coalesce(new_i.sort_order,old_i.sort_order)) from (select * from public.procurement_purchase_order_items where purchase_order_id=v_previous.id) old_i full join (select * from public.procurement_purchase_order_items where purchase_order_id=v_po.id) new_i on new_i.revision_line_key=old_i.revision_line_key where old_i.id is null or new_i.id is null or to_jsonb(old_i) is distinct from to_jsonb(new_i)),'[]'::jsonb)) where id=v_po.id;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'manifest_order',d.manifest_order,'sort_order',d.sort_order,'original_file_name',d.original_file_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,'storage_provider',d.storage_provider,'storage_bucket',d.storage_bucket,'storage_key',d.storage_key,'included_in_pdf',d.mime_type in ('application/pdf','image/jpeg','image/png','image/webp')) order by coalesce(d.sort_order,2147483647),d.created_at,d.id),'[]'::jsonb) into v_manifest
    from (select d.*,row_number() over(order by coalesce(d.sort_order,2147483647),d.created_at,d.id) as manifest_order from public.procurement_purchase_order_documents d where d.purchase_order_id=v_po.id and d.organization_id=v_po.organization_id and d.status='active') d;
  end if;

  if p_action = 'approve' then
    if v_po.previous_revision_id is not null then
      select * into v_previous from public.procurement_purchase_orders where id=v_po.previous_revision_id and organization_id=v_po.organization_id for update;
      if not found or v_previous.status not in ('approved','issued') or v_previous.superseded_by_revision_id is not null then raise exception 'The previous revision is no longer the effective revision.'; end if;
      if exists(select 1 from public.procurement_purchase_orders newer where newer.revision_family_id=v_po.revision_family_id and newer.revision_no>v_po.revision_no and newer.status in ('approved','issued')) then raise exception 'A newer revision is already effective.'; end if;
    end if;
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
  if p_action = 'approve' and v_previous.id is not null then
    update public.procurement_purchase_orders set superseded_by_revision_id=v_po.id where id=v_previous.id;
  end if;
  insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_po.id,p_action,p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  if p_action = 'submit' and v_po.previous_revision_id is not null then
    insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_po.id,'revision_submitted',p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  elsif p_action = 'approve' and v_previous.id is not null then
    insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_po.id,'revision_approved',p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
    insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_previous.id,'revision_superseded',p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  end if;
  return jsonb_build_object('purchase_order_id',v_po.id,'status',v_status);
end;
$$;

revoke all on table public.hr_employee_company_assignments from public, anon, authenticated;

revoke all on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text) to service_role;

commit;
