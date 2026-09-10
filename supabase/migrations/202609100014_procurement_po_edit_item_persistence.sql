begin;

create or replace function public.update_procurement_purchase_order_draft_with_items_atomic(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_fields jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_existing_count integer;
  v_submitted_count integer;
  v_item jsonb;
  v_item_id uuid;
  v_uom text;
  v_charge jsonb;
  v_additional_total numeric := 0;
  v_basic numeric := 0;
  v_gst numeric := 0;
  v_total numeric := 0;
  v_result jsonb;
begin
  select * into v_po
  from public.procurement_purchase_orders
  where id = p_purchase_order_id
    and organization_id = p_organization_id
    and status in ('draft', 'sent_back')
  for update;

  if not found then
    raise exception 'Only a Draft or Sent Back Purchase Order can be edited.';
  end if;

  if jsonb_typeof(coalesce(p_fields->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_fields->'items', '[]'::jsonb)) = 0 then
    raise exception 'Editable Purchase Order items are required.';
  end if;

  select count(*) into v_existing_count
  from public.procurement_purchase_order_items
  where purchase_order_id = p_purchase_order_id;

  select count(*) into v_submitted_count
  from jsonb_array_elements(p_fields->'items');

  if v_existing_count <> v_submitted_count then
    raise exception 'The editable item set changed. Reload the Purchase Order before saving.';
  end if;

  if exists (
    select 1
    from (
      select nullif(value->>'po_item_id', '')::uuid as id
      from jsonb_array_elements(p_fields->'items')
    ) submitted
    where submitted.id is null
       or not exists (
         select 1 from public.procurement_purchase_order_items poi
         where poi.id = submitted.id and poi.purchase_order_id = p_purchase_order_id
       )
       or exists (
         select 1 from jsonb_array_elements(p_fields->'items') other
         where nullif(other->>'po_item_id', '')::uuid = submitted.id
         group by nullif(other->>'po_item_id', '')::uuid
         having count(*) > 1
       )
  ) then
    raise exception 'Every editable item must identify one existing Purchase Order item exactly once.';
  end if;

  for v_item in select * from jsonb_array_elements(p_fields->'items') loop
    v_item_id := nullif(v_item->>'po_item_id', '')::uuid;
    v_uom := null;
    select u.uom_code into v_uom
    from public.procurement_items i
    join public.procurement_uoms u on u.id = i.default_uom_id
    where i.organization_id = p_organization_id
      and i.status = 'active'
      and u.status = 'active'
      and (nullif(v_item->>'item_code', '') is not null and i.item_code = v_item->>'item_code');

    v_uom := coalesce(v_uom, nullif(trim(v_item->>'uom'), ''));
    if v_uom is null then
      raise exception 'Each Purchase Order item needs a Unit.';
    end if;

    update public.procurement_purchase_order_items
    set item_code_snapshot = nullif(v_item->>'item_code', ''),
        item_name_snapshot = coalesce(nullif(v_item->>'item_name', ''), item_name_snapshot),
        specification_snapshot = nullif(coalesce(v_item->>'specification', v_item->>'description'), ''),
        make_snapshot = nullif(coalesce(v_item->>'make_snapshot', v_item->>'make'), ''),
        quantity = (v_item->>'quantity')::numeric,
        uom_snapshot = v_uom,
        unit_rate = nullif(v_item->>'unit_rate', '')::numeric,
        gst_rate = nullif(v_item->>'gst_rate', '')::numeric,
        taxable_amount = round((v_item->>'quantity')::numeric * coalesce(nullif(v_item->>'unit_rate', '')::numeric, 0), 2),
        gst_amount = round(round((v_item->>'quantity')::numeric * coalesce(nullif(v_item->>'unit_rate', '')::numeric, 0), 2) * coalesce(nullif(v_item->>'gst_rate', '')::numeric, 0) / 100, 2),
        total_amount = round((v_item->>'quantity')::numeric * coalesce(nullif(v_item->>'unit_rate', '')::numeric, 0), 2) + round(round((v_item->>'quantity')::numeric * coalesce(nullif(v_item->>'unit_rate', '')::numeric, 0), 2) * coalesce(nullif(v_item->>'gst_rate', '')::numeric, 0) / 100, 2),
        source_requisition_line_key = nullif(v_item->>'source_requisition_line_key', '')::uuid,
        sort_order = coalesce(nullif(v_item->>'sort_order', '')::integer, sort_order)
    where id = v_item_id and purchase_order_id = p_purchase_order_id;
    if not found then
      raise exception 'Purchase Order item was not found.';
    end if;
  end loop;

  select coalesce(sum(taxable_amount), 0), coalesce(sum(gst_amount), 0), coalesce(sum(total_amount), 0)
  into v_basic, v_gst, v_total
  from public.procurement_purchase_order_items
  where purchase_order_id = p_purchase_order_id;

  v_result := public.update_procurement_purchase_order_draft_atomic(
    p_purchase_order_id, p_organization_id, p_fields - 'items', p_actor
  );

  if jsonb_typeof(p_fields->'commercial'->'additional_charges') = 'array' then
    for v_charge in select * from jsonb_array_elements(p_fields->'commercial'->'additional_charges') loop
      v_additional_total := v_additional_total + coalesce(nullif(v_charge->>'amount', '')::numeric, 0);
    end loop;
  else
    v_additional_total := coalesce(v_po.total_additional_charges_amount, 0);
  end if;

  update public.procurement_purchase_orders
  set total_basic_amount = v_basic,
      total_gst_amount = v_gst,
      total_additional_charges_amount = v_additional_total,
      total_amount = v_total + v_additional_total
  where id = p_purchase_order_id and organization_id = p_organization_id and status in ('draft', 'sent_back');

  return v_result;
end;
$$;

revoke all on function public.update_procurement_purchase_order_draft_with_items_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_procurement_purchase_order_draft_with_items_atomic(uuid, uuid, jsonb, jsonb) to service_role;

commit;
