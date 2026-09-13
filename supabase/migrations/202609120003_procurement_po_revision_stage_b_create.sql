begin;
create or replace function public.create_procurement_purchase_order_revision_atomic(p_source_purchase_order_id uuid,p_target_purchase_order_id uuid,p_organization_id uuid,p_documents jsonb,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.procurement_purchase_orders%rowtype; v_family uuid; v_root uuid; v_no integer; v_base text; d jsonb; v_source_document_id uuid;
begin
 if p_source_purchase_order_id=p_target_purchase_order_id then raise exception 'Source and target Purchase Orders must differ.'; end if;
 select * into s from public.procurement_purchase_orders where id=p_source_purchase_order_id and organization_id=p_organization_id for update;
 if not found then raise exception 'Purchase Order was not found.'; end if;
 if s.status <> 'approved' then raise exception 'Only an Approved Purchase Order can be revised.'; end if;
 v_family:=coalesce(s.revision_family_id,gen_random_uuid()); v_root:=coalesce(s.root_purchase_order_id,s.id);
 if exists(select 1 from public.procurement_purchase_orders where revision_family_id=v_family and status in ('draft','pending_approval','sent_back') and id<>s.id) then raise exception 'A revision is already in progress.'; end if;
 if exists(select 1 from public.procurement_purchase_orders where revision_family_id=v_family and status in ('approved','issued') and revision_no>s.revision_no) then raise exception 'The source is not the latest approved revision.'; end if;
 if s.revision_family_id is null then update public.procurement_purchase_orders set revision_family_id=v_family,root_purchase_order_id=v_root where id=s.id; end if;
 select coalesce(max(revision_no),s.revision_no)+1 into v_no from public.procurement_purchase_orders where revision_family_id=v_family;
 v_base:=regexp_replace(s.po_number,'/R-[0-9]+$','');
 insert into public.procurement_purchase_orders(id,organization_id,company_id,site_id,po_number,po_date,revision_no,rfq_number_snapshot,source_requisition_id,source_requisition_number_snapshot,vendor_id,vendor_name_snapshot,vendor_snapshot,delivery_snapshot,commercial_snapshot,standard_terms_snapshot,status,total_basic_amount,total_gst_amount,total_freight_amount,total_amount,source_type,source_requisition_line_key,creation_request_id,template_id,template_version_id,template_snapshot,total_additional_charges_amount,supporting_documents_manifest,revision_family_id,root_purchase_order_id,previous_revision_id,created_by,created_by_name,created_by_email,updated_by,updated_by_name,updated_by_email)
 select p_target_purchase_order_id,s.organization_id,s.company_id,s.site_id,v_base||'/R-'||v_no,s.po_date,v_no,s.rfq_number_snapshot,s.source_requisition_id,s.source_requisition_number_snapshot,s.vendor_id,s.vendor_name_snapshot,s.vendor_snapshot,s.delivery_snapshot,s.commercial_snapshot,s.standard_terms_snapshot,'draft',s.total_basic_amount,s.total_gst_amount,s.total_freight_amount,s.total_amount,s.source_type,s.source_requisition_line_key,null,s.template_id,s.template_version_id,s.template_snapshot,s.total_additional_charges_amount,null,v_family,v_root,s.id,null,null,null,null,null,null;
 insert into public.procurement_purchase_order_items(purchase_order_id,revision_line_key,item_code_snapshot,item_name_snapshot,specification_snapshot,make_snapshot,hsn_sac_snapshot,quantity,uom_snapshot,unit_rate,discount_percent,discount_amount,taxable_amount,gst_rate,gst_amount,total_amount,remarks_snapshot,sort_order,source_requisition_id,source_requisition_line_key)
 select p_target_purchase_order_id,revision_line_key,item_code_snapshot,item_name_snapshot,specification_snapshot,make_snapshot,hsn_sac_snapshot,quantity,uom_snapshot,unit_rate,discount_percent,discount_amount,taxable_amount,gst_rate,gst_amount,total_amount,remarks_snapshot,sort_order,source_requisition_id,source_requisition_line_key from public.procurement_purchase_order_items where purchase_order_id=s.id;
 for d in select * from jsonb_array_elements(coalesce(p_documents,'[]'::jsonb)) loop
   v_source_document_id:=nullif(d->>'source_document_id','')::uuid;
   if not exists(select 1 from public.procurement_purchase_order_documents sd where sd.id=v_source_document_id and sd.organization_id=p_organization_id and sd.purchase_order_id=s.id and sd.status='active' and sd.document_type not in ('signed_po','generated_po','approved_po')) then raise exception 'Revision document metadata is not valid for the source Purchase Order.'; end if;
   insert into public.procurement_purchase_order_documents(organization_id,purchase_order_id,document_type,original_file_name,storage_provider,storage_bucket,storage_key,mime_type,size_bytes,sort_order,created_by,created_by_name,created_by_email) values(p_organization_id,p_target_purchase_order_id,d->>'document_type',d->>'original_file_name',d->>'storage_provider',d->>'storage_bucket',d->>'storage_key',d->>'mime_type',(d->>'size_bytes')::bigint,(d->>'sort_order')::integer,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
 end loop;
 insert into public.procurement_purchase_order_events(purchase_order_id,event_type,actor_id,actor_name,actor_email,changes) values(p_target_purchase_order_id,'revision_created',nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email',jsonb_build_object('source_purchase_order_id',s.id,'source_revision_no',s.revision_no,'new_purchase_order_id',p_target_purchase_order_id,'new_revision_no',v_no));
 return jsonb_build_object('id',p_target_purchase_order_id,'po_number',v_base||'/R-'||v_no,'revision_no',v_no);
end; $$;
revoke all on function public.create_procurement_purchase_order_revision_atomic(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_procurement_purchase_order_revision_atomic(uuid,uuid,uuid,jsonb,jsonb) to service_role;
commit;
