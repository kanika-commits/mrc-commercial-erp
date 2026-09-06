create or replace function public.transition_procurement_purchase_order_atomic(p_purchase_order_id uuid,p_organization_id uuid,p_action text,p_actor jsonb,p_note text default null::text) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_po public.procurement_purchase_orders%rowtype; v_status text; v_manifest jsonb;
begin
  if nullif(p_actor->>'user_id','') is null then raise exception 'Authenticated actor is required.'; end if;
  select * into v_po from public.procurement_purchase_orders where id=p_purchase_order_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found.'; end if;
  v_status := case p_action when 'submit' then 'pending_approval' when 'approve' then 'approved' when 'send_back' then 'sent_back' when 'reject' then 'rejected' when 'issue' then 'issued' else null end;
  if v_status is null then raise exception 'Unsupported Purchase Order action.'; end if;
  if p_action='submit' and v_po.status not in ('draft','sent_back') then raise exception 'Only Draft or Sent Back Purchase Orders can be submitted.'; end if;
  if p_action in ('approve','send_back','reject') and v_po.status <> 'pending_approval' then raise exception 'Only Pending Approval Purchase Orders can be acted on.'; end if;
  if p_action='issue' and v_po.status <> 'approved' then raise exception 'Only Approved Purchase Orders can be issued.'; end if;
  if p_action='submit' then
    select coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'manifest_order',d.manifest_order,'sort_order',d.sort_order,'original_file_name',d.original_file_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,'storage_provider',d.storage_provider,'storage_bucket',d.storage_bucket,'storage_key',d.storage_key,'included_in_pdf',d.mime_type in ('application/pdf','image/jpeg','image/png','image/webp')) order by coalesce(d.sort_order,2147483647),d.created_at,d.id),'[]'::jsonb) into v_manifest
    from (select d.*,row_number() over(order by coalesce(d.sort_order,2147483647),d.created_at,d.id) as manifest_order from public.procurement_purchase_order_documents d where d.purchase_order_id=v_po.id and d.organization_id=v_po.organization_id and d.status='active') d;
  end if;
  update public.procurement_purchase_orders set status=v_status,supporting_documents_manifest=case when p_action='submit' then v_manifest else supporting_documents_manifest end,submitted_by=case when p_action='submit' then nullif(p_actor->>'user_id','')::uuid else submitted_by end,submitted_by_name=case when p_action='submit' then p_actor->>'name' else submitted_by_name end,submitted_at=case when p_action='submit' then now() else submitted_at end,approved_by=case when p_action='approve' then nullif(p_actor->>'user_id','')::uuid else approved_by end,approved_by_name=case when p_action='approve' then p_actor->>'name' else approved_by_name end,approved_at=case when p_action='approve' then now() else approved_at end,issued_by=case when p_action='issue' then nullif(p_actor->>'user_id','')::uuid else issued_by end,issued_by_name=case when p_action='issue' then p_actor->>'name' else issued_by_name end,issued_at=case when p_action='issue' then now() else issued_at end,updated_at=now() where id=v_po.id;
  insert into public.procurement_purchase_order_events(purchase_order_id,event_type,event_note,actor_id,actor_name,actor_email) values(v_po.id,p_action,p_note,nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  return jsonb_build_object('purchase_order_id',v_po.id,'status',v_status);
end;
$function$;

create or replace function public.add_procurement_purchase_order_document_atomic(p_purchase_order_id uuid,p_organization_id uuid,p_document jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_po public.procurement_purchase_orders%rowtype; v_mime text; v_size bigint; v_row public.procurement_purchase_order_documents%rowtype;
begin
  select * into v_po from public.procurement_purchase_orders where id=p_purchase_order_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found.'; end if;
  if v_po.status <> 'draft' then raise exception 'Attachments can only be added while the Purchase Order is Draft.'; end if;
  v_mime:=p_document->>'mime_type'; v_size:=greatest(coalesce((p_document->>'size_bytes')::bigint,0),0);
  if v_mime in ('application/pdf','image/jpeg','image/png','image/webp') and coalesce((select sum(size_bytes) from public.procurement_purchase_order_documents where purchase_order_id=v_po.id and organization_id=v_po.organization_id and status='active' and mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),0)+v_size > 25*1024*1024 then raise exception 'Package-eligible supporting documents must be 25 MB or smaller in total.'; end if;
  insert into public.procurement_purchase_order_documents(organization_id,purchase_order_id,document_type,original_file_name,storage_provider,storage_bucket,storage_key,mime_type,size_bytes,sort_order,created_by,created_by_name,created_by_email) values(p_organization_id,p_purchase_order_id,p_document->>'document_type',p_document->>'original_file_name',p_document->>'storage_provider',p_document->>'storage_bucket',p_document->>'storage_key',v_mime,v_size,(p_document->>'sort_order')::integer,nullif(p_document->>'created_by','')::uuid,p_document->>'created_by_name',p_document->>'created_by_email') returning * into v_row;
  return jsonb_build_object('id',v_row.id,'purchase_order_id',v_row.purchase_order_id,'document_type',v_row.document_type,'original_file_name',v_row.original_file_name,'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,'status',v_row.status,'sort_order',v_row.sort_order,'created_by_name',v_row.created_by_name,'created_at',v_row.created_at);
end;
$function$;

create or replace function public.remove_procurement_purchase_order_document_atomic(p_purchase_order_id uuid,p_organization_id uuid,p_document_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_po public.procurement_purchase_orders%rowtype; v_row public.procurement_purchase_order_documents%rowtype;
begin
  select * into v_po from public.procurement_purchase_orders where id=p_purchase_order_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found.'; end if;
  if v_po.status <> 'draft' then raise exception 'Attachments cannot be removed after the Purchase Order leaves Draft.'; end if;
  select * into v_row from public.procurement_purchase_order_documents where id=p_document_id and purchase_order_id=v_po.id and organization_id=v_po.organization_id and status='active' for update;
  if not found then raise exception 'Attachment was not found.'; end if;
  delete from public.procurement_purchase_order_documents where id=v_row.id;
  return jsonb_build_object('id',v_row.id,'storage_bucket',v_row.storage_bucket,'storage_key',v_row.storage_key);
end;
$function$;

create or replace function public.reorder_procurement_purchase_order_documents_atomic(p_purchase_order_id uuid,p_organization_id uuid,p_document_ids uuid[]) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_po public.procurement_purchase_orders%rowtype; v_count integer; v_index integer; v_id uuid;
begin
  select * into v_po from public.procurement_purchase_orders where id=p_purchase_order_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found.'; end if;
  if v_po.status <> 'draft' then raise exception 'Attachments can only be reordered while the Purchase Order is Draft.'; end if;
  select count(*) into v_count from public.procurement_purchase_order_documents where purchase_order_id=v_po.id and organization_id=v_po.organization_id and status='active';
  if coalesce(array_length(p_document_ids,1),0)<>v_count or (select count(distinct x) from unnest(p_document_ids) x)<>v_count or exists(select 1 from unnest(p_document_ids) x where not exists(select 1 from public.procurement_purchase_order_documents d where d.id=x and d.purchase_order_id=v_po.id and d.organization_id=v_po.organization_id and d.status='active')) then raise exception 'The supporting-document order is invalid.'; end if;
  for v_id,v_index in select x,ordinality-1 from unnest(p_document_ids) with ordinality x loop update public.procurement_purchase_order_documents set sort_order=v_index where id=v_id and purchase_order_id=v_po.id and organization_id=v_po.organization_id; end loop;
  return jsonb_build_object('reordered',true);
end;
$function$;
