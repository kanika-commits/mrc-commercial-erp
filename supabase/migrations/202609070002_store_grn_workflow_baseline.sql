begin;

create or replace function public.next_procurement_goods_receipt_number(p_organization_id uuid, p_grn_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number bigint;
begin
  v_number := nextval('public.procurement_goods_receipt_number_seq');
  return 'GRN/' || to_char(p_grn_date, 'YYYY') || '/' || lpad(v_number::text, 5, '0');
end;
$$;

create or replace function public.recalculate_goods_receipt_weight_reconciliation(p_grn_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gross numeric;
  v_tare numeric;
  v_received numeric;
begin
  select nullif(final_value, '')::numeric
    into v_gross
    from public.procurement_goods_receipt_verified_values
   where grn_id = p_grn_id and field_name = 'gross_weight'
   order by verified_at desc, created_at desc
   limit 1;

  select nullif(final_value, '')::numeric
    into v_tare
    from public.procurement_goods_receipt_verified_values
   where grn_id = p_grn_id and field_name = 'tare_weight'
   order by verified_at desc, created_at desc
   limit 1;

  select sum(
    case
      when lower(regexp_replace(coalesce(uom_snapshot, ''), '[^a-z]', '', 'g')) in ('kg', 'kgs', 'kilogram', 'kilograms') then received_quantity
      when lower(regexp_replace(coalesce(uom_snapshot, ''), '[^a-z]', '', 'g')) in ('mt', 'metricton', 'metrictons', 'metrictonne', 'metrictonnes', 'tonne', 'tonnes') then received_quantity * 1000
      else null
    end
  ) into v_received
  from public.procurement_goods_receipt_items
  where grn_id = p_grn_id;

  update public.procurement_goods_receipts
     set normalized_received_kg = case when v_received is not null and v_gross is not null and v_tare is not null and v_gross > v_tare then round(v_received, 3) else null end,
         weighbridge_net_kg = case when v_received is not null and v_gross is not null and v_tare is not null and v_gross > v_tare then round(v_gross - v_tare, 3) else null end,
         weight_difference_kg = case when v_received is not null and v_gross is not null and v_tare is not null and v_gross > v_tare then round(v_received - (v_gross - v_tare), 3) else null end,
         weight_reconciliation_status = case when v_received is not null and v_gross is not null and v_tare is not null and v_gross > v_tare then case when round(v_received - (v_gross - v_tare), 3) = 0 then 'match' else 'warning' end else null end
   where id = p_grn_id;
end;
$$;

create or replace function public.refresh_goods_receipt_weight_reconciliation_from_verified_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.field_name in ('gross_weight', 'tare_weight') then
      perform public.recalculate_goods_receipt_weight_reconciliation(old.grn_id);
    end if;
    return old;
  end if;
  if new.field_name in ('gross_weight', 'tare_weight') then
    perform public.recalculate_goods_receipt_weight_reconciliation(new.grn_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_goods_receipt_weight_from_verified_value on public.procurement_goods_receipt_verified_values;
create trigger trg_refresh_goods_receipt_weight_from_verified_value
after insert or update of final_value, field_name, grn_id or delete
on public.procurement_goods_receipt_verified_values
for each row execute function public.refresh_goods_receipt_weight_reconciliation_from_verified_value();

create or replace function public.reconcile_goods_receipt_item_weight()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_goods_receipt_weight_reconciliation(old.grn_id);
    return old;
  end if;
  perform public.recalculate_goods_receipt_weight_reconciliation(new.grn_id);
  if tg_op = 'UPDATE' and old.grn_id is distinct from new.grn_id then
    perform public.recalculate_goods_receipt_weight_reconciliation(old.grn_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_goods_receipt_item_weight on public.procurement_goods_receipt_items;
create trigger trg_reconcile_goods_receipt_item_weight
after insert or update of received_quantity, uom_snapshot, weight_uom, weight_based or delete
on public.procurement_goods_receipt_items
for each row execute function public.reconcile_goods_receipt_item_weight();

create or replace function public.prevent_finalized_goods_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grn_id uuid;
begin
  if tg_table_name = 'procurement_goods_receipts' then
    if old.status = 'finalized' then
      raise exception 'Finalized Goods Receipt Notes are immutable.';
    end if;
  else
    if tg_op = 'DELETE' then
      v_grn_id := old.grn_id;
    else
      v_grn_id := new.grn_id;
    end if;
    if exists (select 1 from public.procurement_goods_receipts where id = v_grn_id and status = 'finalized') then
      raise exception 'Evidence and verified values on finalized Goods Receipt Notes are immutable.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_finalized_goods_receipts on public.procurement_goods_receipts;
create trigger trg_lock_finalized_goods_receipts
before update or delete on public.procurement_goods_receipts
for each row execute function public.prevent_finalized_goods_receipt_mutation();

drop trigger if exists trg_lock_finalized_goods_receipt_items on public.procurement_goods_receipt_items;
create trigger trg_lock_finalized_goods_receipt_items
before insert or update or delete on public.procurement_goods_receipt_items
for each row execute function public.prevent_finalized_goods_receipt_mutation();

drop trigger if exists trg_lock_finalized_goods_receipt_documents on public.procurement_goods_receipt_documents;
create trigger trg_lock_finalized_goods_receipt_documents
before insert or update or delete on public.procurement_goods_receipt_documents
for each row execute function public.prevent_finalized_goods_receipt_mutation();

drop trigger if exists trg_lock_finalized_goods_receipt_values on public.procurement_goods_receipt_verified_values;
create trigger trg_lock_finalized_goods_receipt_values
before insert or update or delete on public.procurement_goods_receipt_verified_values
for each row execute function public.prevent_finalized_goods_receipt_mutation();

create or replace function public.finalize_procurement_goods_receipt_atomic(p_grn_id uuid, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grn public.procurement_goods_receipts%rowtype;
  v_po public.procurement_purchase_orders%rowtype;
  v_item record;
  v_accepted numeric;
  v_gross numeric;
  v_tare numeric;
  v_net numeric;
  v_has_invoice boolean;
  v_has_challan boolean;
begin
  select * into v_grn
    from public.procurement_goods_receipts
   where id = p_grn_id
   for update;
  if not found then raise exception 'Goods Receipt Note was not found.'; end if;
  if v_grn.status <> 'draft' then raise exception 'Only Draft Goods Receipt Notes can be finalized.'; end if;

  select * into v_po
    from public.procurement_purchase_orders
   where id = v_grn.purchase_order_id
   for update;
  if not found or v_po.status not in ('approved', 'issued') then
    raise exception 'Only Approved or Issued Purchase Orders can receive goods.';
  end if;
  if v_grn.organization_id <> v_po.organization_id or v_grn.company_id <> v_po.company_id or v_grn.site_id <> v_po.site_id then
    raise exception 'GRN scope does not match the source Purchase Order.';
  end if;

  select exists (
    select 1 from public.procurement_goods_receipt_verified_values
     where grn_id = p_grn_id and field_name = 'invoice_number' and nullif(btrim(final_value), '') is not null
  ) and exists (
    select 1 from public.procurement_goods_receipt_verified_values
     where grn_id = p_grn_id and field_name = 'invoice_date' and nullif(btrim(final_value), '') is not null
  ) and exists (
    select 1 from public.procurement_goods_receipt_documents
     where grn_id = p_grn_id and document_type = 'invoice' and status = 'active'
  ) into v_has_invoice;
  select exists (
    select 1 from public.procurement_goods_receipt_documents
     where grn_id = p_grn_id and document_type = 'delivery_challan' and status = 'active'
  ) into v_has_challan;
  if not v_has_invoice and not v_has_challan then
    raise exception 'Add either Invoice details/document or a Delivery Challan before finalizing this receipt.';
  end if;

  if not exists (select 1 from public.procurement_goods_receipt_items where grn_id = p_grn_id) then
    raise exception 'At least one GRN item is required.';
  end if;
  if exists (
    select 1
      from public.procurement_goods_receipt_items i
      left join public.procurement_purchase_order_items po on po.id = i.purchase_order_item_id
     where i.grn_id = p_grn_id and (po.id is null or po.purchase_order_id <> v_grn.purchase_order_id)
  ) then
    raise exception 'Every GRN item must belong to the source Purchase Order.';
  end if;

  for v_item in
    select i.*, po.quantity as ordered_quantity
      from public.procurement_goods_receipt_items i
      join public.procurement_purchase_order_items po on po.id = i.purchase_order_item_id
     where i.grn_id = p_grn_id and po.purchase_order_id = v_grn.purchase_order_id
  loop
    if v_item.received_quantity < 0 or v_item.accepted_quantity < 0 or v_item.rejected_quantity < 0 or v_item.hold_quantity < 0 then
      raise exception 'GRN quantities cannot be negative.';
    end if;
    if v_item.received_quantity <> v_item.accepted_quantity + v_item.rejected_quantity + v_item.hold_quantity then
      raise exception 'Received quantity must equal Accepted + Rejected + Hold.';
    end if;
    if v_item.rejected_quantity > 0 and nullif(btrim(v_item.rejection_reason), '') is null then
      raise exception 'Enter a rejection reason before finalizing this GRN.';
    end if;
    if v_item.accepted_quantity > v_item.ordered_quantity then
      raise exception 'Accepted quantity cannot exceed the PO quantity.';
    end if;

    select coalesce(sum(gi.accepted_quantity), 0) into v_accepted
      from public.procurement_goods_receipt_items gi
      join public.procurement_goods_receipts gh on gh.id = gi.grn_id
     where gi.purchase_order_item_id = v_item.purchase_order_item_id
       and gh.status = 'finalized'
       and gh.id <> p_grn_id;
    if v_accepted + v_item.accepted_quantity > v_item.ordered_quantity then
      raise exception 'Accepted quantity exceeds the remaining PO quantity.';
    end if;

    if v_item.weight_based then
      if not exists (select 1 from public.procurement_goods_receipt_documents where grn_id = p_grn_id and document_type = 'weighbridge_slip' and status = 'active') then
        raise exception 'A Weighbridge Slip is required for weight-based receipt items.';
      end if;
      select nullif(final_value, '')::numeric into v_gross from public.procurement_goods_receipt_verified_values where grn_id = p_grn_id and field_name = 'gross_weight' order by verified_at desc, created_at desc limit 1;
      select nullif(final_value, '')::numeric into v_tare from public.procurement_goods_receipt_verified_values where grn_id = p_grn_id and field_name = 'tare_weight' order by verified_at desc, created_at desc limit 1;
      if v_gross is null or v_tare is null or v_gross <= 0 or v_tare < 0 or v_gross <= v_tare then
        raise exception 'Verified Gross and Tare weights are required for weight-based receipt items.';
      end if;
      v_net := v_gross - v_tare;
      if not exists (select 1 from public.procurement_goods_receipt_verified_values where grn_id = p_grn_id and field_name = 'net_weight' and source_type = 'system_calculated') then
        insert into public.procurement_goods_receipt_verified_values(organization_id, grn_id, field_name, source_type, final_value, verified_by)
        values (v_grn.organization_id, p_grn_id, 'net_weight', 'system_calculated', v_net::text, nullif(p_actor->>'user_id', '')::uuid);
      end if;
    end if;
  end loop;

  update public.procurement_goods_receipts
     set status = 'finalized', finalized_by = nullif(p_actor->>'user_id', '')::uuid,
         finalized_by_name = p_actor->>'name', finalized_by_email = p_actor->>'email',
         finalized_at = now(), updated_at = now()
   where id = p_grn_id and status = 'draft';
  if not found then raise exception 'Only Draft Goods Receipt Notes can be finalized.'; end if;

  insert into public.procurement_goods_receipt_events(grn_id, event_type, actor_id, actor_name, actor_email, metadata)
  values (p_grn_id, 'finalized', nullif(p_actor->>'user_id', '')::uuid, p_actor->>'name', p_actor->>'email', jsonb_build_object('status', 'finalized'));
  return jsonb_build_object('grn_id', p_grn_id, 'status', 'finalized');
end;
$$;

commit;
