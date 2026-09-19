begin;

-- Reconcile an editor's intended final item rows against the exact persisted
-- item ID set loaded by that editor. The PO row lock and the ID-set comparison
-- keep intentional removal distinct from a stale/concurrent item-set change.
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
  v_current_ids uuid[] := '{}'::uuid[];
  v_expected_ids uuid[] := '{}'::uuid[];
  v_final_ids uuid[] := '{}'::uuid[];
  v_expected_count integer := 0;
  v_expected_distinct_count integer := 0;
  v_final_persisted_count integer := 0;
  v_final_persisted_distinct_count integer := 0;
  v_item jsonb;
  v_item_id uuid;
  v_source_line_key uuid;
  v_uom text;
  v_qty numeric;
  v_unit numeric;
  v_gst_rate numeric;
  v_taxable numeric;
  v_gst numeric;
  v_total_line numeric;
  v_charge jsonb;
  v_additional_total numeric := 0;
  v_basic numeric := 0;
  v_gst_total numeric := 0;
  v_total numeric := 0;
  v_result jsonb;
  v_deleted record;
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
  if jsonb_typeof(p_fields->'expected_original_item_ids') <> 'array' then
    raise exception 'Expected original Purchase Order item IDs are required. Reload the Purchase Order before saving.';
  end if;

  select count(*), count(distinct value::uuid)
    into v_expected_count, v_expected_distinct_count
  from jsonb_array_elements_text(p_fields->'expected_original_item_ids');
  if v_expected_count <> v_expected_distinct_count then
    raise exception 'Expected original Purchase Order item IDs must not contain duplicates.';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
    into v_expected_ids
  from jsonb_array_elements_text(p_fields->'expected_original_item_ids');

  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into v_current_ids
  from public.procurement_purchase_order_items
  where purchase_order_id = p_purchase_order_id;

  if v_current_ids is distinct from v_expected_ids then
    raise exception 'The editable item set changed. Reload the Purchase Order before saving.';
  end if;

  select count(*) filter (where nullif(value->>'po_item_id', '') is not null),
         count(distinct nullif(value->>'po_item_id', '')::uuid)
    into v_final_persisted_count, v_final_persisted_distinct_count
  from jsonb_array_elements(p_fields->'items');
  if v_final_persisted_count <> v_final_persisted_distinct_count then
    raise exception 'A persisted Purchase Order item may appear only once.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fields->'items') submitted
    where nullif(submitted->>'po_item_id', '') is not null
      and not exists (
        select 1
        from public.procurement_purchase_order_items poi
        where poi.id = nullif(submitted->>'po_item_id', '')::uuid
          and poi.purchase_order_id = p_purchase_order_id
      )
  ) then
    raise exception 'Every persisted item ID must belong to this Purchase Order.';
  end if;

  select coalesce(array_agg(distinct nullif(value->>'po_item_id', '')::uuid order by nullif(value->>'po_item_id', '')::uuid)
                  filter (where nullif(value->>'po_item_id', '') is not null), '{}'::uuid[])
    into v_final_ids
  from jsonb_array_elements(p_fields->'items');

  -- Delete only rows intentionally omitted from the final set. Keep restrictive
  -- foreign keys as a final barrier and report known GRN dependencies clearly.
  for v_deleted in
    select poi.id
    from public.procurement_purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id
      and not (poi.id = any(v_final_ids))
  loop
    if exists (
      select 1 from public.procurement_goods_receipt_items gri
      where gri.purchase_order_item_id = v_deleted.id
    ) then
      raise exception 'This item cannot be removed because a Goods Receipt references it.';
    end if;
    delete from public.procurement_purchase_order_items
    where id = v_deleted.id and purchase_order_id = p_purchase_order_id;
  end loop;

  for v_item in select value from jsonb_array_elements(p_fields->'items') loop
    v_item_id := nullif(v_item->>'po_item_id', '')::uuid;
    v_source_line_key := nullif(v_item->>'source_requisition_line_key', '')::uuid;
    v_qty := nullif(v_item->>'quantity', '')::numeric;
    v_unit := nullif(v_item->>'unit_rate', '')::numeric;
    v_gst_rate := nullif(v_item->>'gst_rate', '')::numeric;

    -- Keep the previous RPC's active Material Master UOM lookup and payload
    -- fallback. Edit-time Indent eligibility and quantity validation remains
    -- with the existing queue and submit/approval protections.
    v_uom := null;
    select u.uom_code into v_uom
    from public.procurement_items i
    join public.procurement_uoms u on u.id = i.default_uom_id
    where i.organization_id = p_organization_id
      and i.status = 'active' and u.status = 'active'
      and nullif(v_item->>'item_code', '') is not null
      and i.item_code = v_item->>'item_code';
    v_uom := coalesce(v_uom, nullif(trim(v_item->>'uom'), ''));
    if v_uom is null then raise exception 'Each Purchase Order item needs a Unit.'; end if;

    v_taxable := round(v_qty * coalesce(v_unit, 0), 2);
    v_gst := round(v_taxable * coalesce(v_gst_rate, 0) / 100, 2);
    v_total_line := v_taxable + v_gst;

    if v_item_id is not null then
      update public.procurement_purchase_order_items
      set item_code_snapshot = nullif(v_item->>'item_code', ''),
          item_name_snapshot = coalesce(nullif(v_item->>'item_name', ''), item_name_snapshot),
          specification_snapshot = nullif(coalesce(v_item->>'specification', v_item->>'description'), ''),
          make_snapshot = nullif(coalesce(v_item->>'make_snapshot', v_item->>'make'), ''),
          quantity = v_qty,
          uom_snapshot = v_uom,
          unit_rate = v_unit,
          gst_rate = v_gst_rate,
          taxable_amount = v_taxable,
          gst_amount = v_gst,
          total_amount = v_total_line,
          sort_order = coalesce(nullif(v_item->>'sort_order', '')::integer, sort_order)
      where id = v_item_id and purchase_order_id = p_purchase_order_id;
      if not found then raise exception 'Purchase Order item was not found.'; end if;
    else
      insert into public.procurement_purchase_order_items(
        purchase_order_id, revision_line_key, source_requisition_id, source_requisition_line_key,
        item_code_snapshot, item_name_snapshot, specification_snapshot, make_snapshot,
        quantity, uom_snapshot, unit_rate, gst_rate, taxable_amount, gst_amount,
        total_amount, sort_order
      ) values (
        p_purchase_order_id, gen_random_uuid(),
        case when v_po.source_type = 'indent' then v_po.source_requisition_id else null end,
        v_source_line_key,
        nullif(v_item->>'item_code', ''), nullif(trim(v_item->>'item_name'), ''),
        nullif(coalesce(v_item->>'specification', v_item->>'description'), ''),
        nullif(coalesce(v_item->>'make_snapshot', v_item->>'make'), ''),
        v_qty, v_uom, v_unit, v_gst_rate, v_taxable, v_gst, v_total_line,
        coalesce(nullif(v_item->>'sort_order', '')::integer, 1)
      );
    end if;
  end loop;

  select coalesce(sum(taxable_amount), 0), coalesce(sum(gst_amount), 0), coalesce(sum(total_amount), 0)
    into v_basic, v_gst_total, v_total
  from public.procurement_purchase_order_items
  where purchase_order_id = p_purchase_order_id;

  v_result := public.update_procurement_purchase_order_draft_atomic(
    p_purchase_order_id, p_organization_id,
    p_fields - 'items' - 'expected_original_item_ids', p_actor
  );

  if jsonb_typeof(p_fields->'commercial'->'additional_charges') = 'array' then
    for v_charge in select value from jsonb_array_elements(p_fields->'commercial'->'additional_charges') loop
      v_additional_total := v_additional_total + coalesce(nullif(v_charge->>'amount', '')::numeric, 0);
    end loop;
  else
    v_additional_total := coalesce(v_po.total_additional_charges_amount, 0);
  end if;

  update public.procurement_purchase_orders
  set total_basic_amount = v_basic,
      total_gst_amount = v_gst_total,
      total_additional_charges_amount = v_additional_total,
      total_amount = v_total + v_additional_total
  where id = p_purchase_order_id
    and organization_id = p_organization_id
    and status in ('draft', 'sent_back');

  return v_result;
end;
$$;

revoke all on function public.update_procurement_purchase_order_draft_with_items_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_procurement_purchase_order_draft_with_items_atomic(uuid, uuid, jsonb, jsonb) to service_role;

commit;
