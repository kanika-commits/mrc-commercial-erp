create or replace function public.update_procurement_purchase_order_draft_atomic(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_fields jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_delivery_snapshot jsonb;
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

  v_delivery_snapshot := coalesce(v_po.delivery_snapshot, '{}'::jsonb)
    || coalesce(p_fields->'delivery', '{}'::jsonb)
    || public.resolve_procurement_po_master_snapshot(
      p_organization_id,
      v_po.company_id,
      v_po.site_id,
      p_fields
    );

  update public.procurement_purchase_orders
  set po_date = coalesce(nullif(p_fields->>'po_date', '')::date, po_date),
      delivery_snapshot = v_delivery_snapshot,
      commercial_snapshot = coalesce(commercial_snapshot, '{}'::jsonb) || coalesce(p_fields->'commercial', '{}'::jsonb),
      standard_terms_snapshot = coalesce(p_fields->>'standard_terms', standard_terms_snapshot),
      updated_by = nullif(p_actor->>'user_id', '')::uuid,
      updated_by_name = p_actor->>'name',
      updated_by_email = p_actor->>'email',
      updated_at = now()
  where id = p_purchase_order_id
    and organization_id = p_organization_id
    and status in ('draft', 'sent_back');

  if not found then
    raise exception 'Only a Draft or Sent Back Purchase Order can be edited.';
  end if;

  insert into public.procurement_purchase_order_events(
    purchase_order_id, event_type, actor_id, actor_name, actor_email, changes
  )
  values (
    p_purchase_order_id,
    'draft_updated',
    nullif(p_actor->>'user_id', '')::uuid,
    p_actor->>'name',
    p_actor->>'email',
    p_fields || jsonb_build_object('resolved_master_selection', v_delivery_snapshot->'master_selection')
  );

  return jsonb_build_object('purchase_order_id', p_purchase_order_id);
end;
$$;

create or replace function public.update_procurement_purchase_order_draft_with_additional_charges(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_fields jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge jsonb;
  v_name text;
  v_amount numeric;
  v_total numeric := 0;
  v_result jsonb;
begin
  if jsonb_typeof(coalesce(p_fields->'commercial'->'additional_charges', '[]'::jsonb)) <> 'array' then
    raise exception 'Additional charges must be an array.';
  end if;

  for v_charge in select * from jsonb_array_elements(coalesce(p_fields->'commercial'->'additional_charges', '[]'::jsonb)) loop
    v_name := nullif(trim(v_charge->>'name'), '');
    v_amount := nullif(v_charge->>'amount', '')::numeric;
    if v_name is null or v_amount is null or v_amount < 0 then
      raise exception 'Each additional charge needs a name and a valid non-negative amount.';
    end if;
    v_total := v_total + v_amount;
  end loop;

  v_result := public.update_procurement_purchase_order_draft_atomic(
    p_purchase_order_id, p_organization_id, p_fields, p_actor
  );

  update public.procurement_purchase_orders
  set total_additional_charges_amount = v_total,
      total_amount = coalesce(total_basic_amount, 0)
        + coalesce(total_gst_amount, 0)
        + coalesce(total_freight_amount, 0)
        + v_total
  where id = p_purchase_order_id
    and organization_id = p_organization_id
    and status in ('draft', 'sent_back');

  if not found then
    raise exception 'Only a Draft or Sent Back Purchase Order can be edited.';
  end if;

  return v_result;
end;
$$;

create or replace function public.update_procurement_po_draft_with_additional_charges_atomic(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_fields jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.update_procurement_purchase_order_draft_with_additional_charges(
    p_purchase_order_id, p_organization_id, p_fields, p_actor
  );
end;
$$;

create or replace function public.set_procurement_purchase_order_freight_atomic(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_freight_amount numeric,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_freight numeric := coalesce(p_freight_amount, 0);
  v_total numeric;
begin
  if nullif(p_actor->>'user_id', '') is null then
    raise exception 'Authenticated actor is required.';
  end if;
  if v_freight < 0 then
    raise exception 'Freight amount must be a non-negative number.';
  end if;

  select * into v_po
  from public.procurement_purchase_orders
  where id = p_purchase_order_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Purchase Order was not found in the supplied organization.';
  end if;
  if v_po.status not in ('draft', 'sent_back') then
    raise exception 'Freight can be changed only while the Purchase Order is an editable draft.';
  end if;
  if v_po.source_type not in ('direct', 'indent') then
    raise exception 'Freight is not supported for this Purchase Order source.';
  end if;

  v_total := coalesce(v_po.total_basic_amount, 0)
    + coalesce(v_po.total_gst_amount, 0)
    + v_freight
    + coalesce(v_po.total_additional_charges_amount, 0);

  update public.procurement_purchase_orders
  set total_freight_amount = v_freight,
      total_amount = v_total,
      commercial_snapshot = coalesce(commercial_snapshot, '{}'::jsonb) || jsonb_build_object('freight_amount', v_freight),
      updated_by = nullif(p_actor->>'user_id', '')::uuid,
      updated_by_name = p_actor->>'name',
      updated_by_email = p_actor->>'email',
      updated_at = now()
  where id = v_po.id;

  insert into public.procurement_purchase_order_events(
    purchase_order_id, event_type, actor_id, actor_name, actor_email, changes
  )
  values (
    v_po.id,
    'freight_updated',
    nullif(p_actor->>'user_id', '')::uuid,
    p_actor->>'name',
    p_actor->>'email',
    jsonb_build_object('total_freight_amount', v_freight)
  );

  return jsonb_build_object(
    'purchase_order_id', v_po.id,
    'total_freight_amount', v_freight,
    'total_amount', v_total
  );
end;
$$;
