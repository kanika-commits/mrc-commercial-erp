begin;

create or replace function public.procurement_purchase_order_cumulative_received(p_organization_id uuid,p_purchase_order_id uuid,p_revision_line_key uuid)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(sum(coalesce(gri.accepted_quantity,0)),0)
    from public.procurement_goods_receipt_items gri
    join public.procurement_goods_receipts gr on gr.id=gri.grn_id and gr.status='finalized'
    join public.procurement_purchase_order_items poi on poi.id=gri.purchase_order_item_id and poi.revision_line_key=p_revision_line_key
    join public.procurement_purchase_orders po on po.id=poi.purchase_order_id and po.organization_id=p_organization_id
    join public.procurement_purchase_orders anchor on anchor.id=p_purchase_order_id and anchor.organization_id=p_organization_id
   where (anchor.revision_family_id is null and po.id=anchor.id) or (anchor.revision_family_id is not null and po.revision_family_id=anchor.revision_family_id);
$$;

create or replace function public.validate_procurement_purchase_order_revision_receipts()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare line record; received numeric;
begin
  if new.previous_revision_id is null or new.status not in ('pending_approval','approved') then return new; end if;
  for line in select revision_line_key,quantity,item_name_snapshot from public.procurement_purchase_order_items where purchase_order_id=new.id and revision_line_key is not null loop
    received:=public.procurement_purchase_order_cumulative_received(new.organization_id,new.id,line.revision_line_key);
    if coalesce(line.quantity,0)<received then raise exception 'Revision quantity for % (%) is below cumulative received quantity (%).',coalesce(line.item_name_snapshot,'item'),coalesce(line.quantity,0),received; end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_validate_po_revision_receipts on public.procurement_purchase_orders;
create trigger trg_validate_po_revision_receipts before update of status on public.procurement_purchase_orders for each row when (new.status in ('pending_approval','approved') and old.status is distinct from new.status) execute function public.validate_procurement_purchase_order_revision_receipts();

revoke all on function public.procurement_purchase_order_cumulative_received(uuid,uuid,uuid),public.validate_procurement_purchase_order_revision_receipts() from public,anon,authenticated;
grant execute on function public.procurement_purchase_order_cumulative_received(uuid,uuid,uuid),public.validate_procurement_purchase_order_revision_receipts() to service_role;
commit;
