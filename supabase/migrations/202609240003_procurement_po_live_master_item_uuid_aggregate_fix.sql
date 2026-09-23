-- Correct UUID aggregate bug in future-only PO Item Master functions.
begin;

create or replace function public.populate_procurement_purchase_order_item_master_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_item_id uuid;
  v_count integer;
begin
  if new.item_id is not null then return new; end if;
  if nullif(btrim(new.item_code_snapshot), '') is null then return new; end if;

  select po.organization_id into v_organization_id
  from public.procurement_purchase_orders po
  where po.id = new.purchase_order_id;

  select count(*)
    into v_count
  from public.procurement_items i
  where i.organization_id = v_organization_id
    and i.status = 'active'
    and i.item_code = new.item_code_snapshot
    and i.item_name = new.item_name_snapshot;

  if v_count = 1 then
    select i.id into v_item_id
    from public.procurement_items i
    where i.organization_id = v_organization_id
      and i.status = 'active'
      and i.item_code = new.item_code_snapshot
      and i.item_name = new.item_name_snapshot;
    new.item_id := v_item_id;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_procurement_purchase_order_draft_v2_atomic(
  p_source_type text,
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_vendor_id uuid,
  p_vendor_snapshot jsonb,
  p_source_requisition_id uuid,
  p_source_requisition_number text,
  p_items jsonb,
  p_fields jsonb,
  p_actor jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_item jsonb;
  v_master_item_id uuid;
  v_has_master_item_id boolean;
  v_count integer;
  v_qty numeric;
  v_unit numeric;
  v_gst_rate numeric;
  v_taxable numeric;
  v_gst numeric;
  v_total numeric;
  v_basic numeric := 0;
  v_gst_total numeric := 0;
  v_total_amount numeric := 0;
  v_vendor_name text := nullif(trim(p_vendor_snapshot->>'vendor_name'), '');
  v_template_id uuid;
  v_template_version_id uuid;
  v_template_snapshot jsonb;
  v_terms_snapshot jsonb;
  v_additional_charges jsonb := '[]'::jsonb;
  v_additional_total numeric := 0;
  v_charge jsonb;
  v_charge_name text;
  v_charge_amount numeric;
  v_delivery_snapshot jsonb;
begin
  select t.id, v.id, jsonb_build_object(
           'template_id', t.id,
           'template_version_id', v.id,
           'template_name', t.template_name,
           'template_code', t.template_code,
           'version_number', v.version_number,
           'layout_definition', v.layout_definition,
           'header_asset_reference', v.header_asset_reference,
           'footer_asset_reference', v.footer_asset_reference,
           'source_original_filename', v.source_original_filename
         )
    into v_template_id, v_template_version_id, v_template_snapshot
    from public.procurement_purchase_order_templates t
    join public.procurement_purchase_order_template_versions v
      on v.template_id = t.id
   where t.organization_id = p_organization_id
     and t.company_id = p_company_id
     and t.status = 'active'
     and t.is_default
     and v.status = 'active'
     and v.readiness_status = 'ready'
   order by v.version_number desc, v.id desc
   limit 1
   for update of t, v;

  if v_template_id is null then
    raise exception 'No Ready default Purchase Order template is configured for the selected company.';
  end if;

  if p_source_type not in ('direct','indent') then
    raise exception 'Direct draft creation supports only Direct or Material Indent sources.';
  end if;

  if nullif(p_actor->>'user_id','') is null then
    raise exception 'Authenticated actor is required.';
  end if;

  if p_vendor_id is null then
    raise exception 'Vendor is required.';
  end if;

  if v_vendor_name is null then
    raise exception 'Vendor name is required.';
  end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array'
     or coalesce(jsonb_array_length(p_items),0) = 0
  then
    raise exception 'At least one Purchase Order item is required.';
  end if;

  if p_source_type = 'indent'
     and p_source_requisition_id is null
  then
    raise exception 'Material Indent source is required.';
  end if;

  if not exists (
    select 1
      from public.companies c
     where c.id = p_company_id
       and c.organization_id = p_organization_id
       and coalesce(c.status,'active') <> 'deleted'
  ) then
    raise exception 'Company is outside the supplied organization.';
  end if;

  if not exists (
    select 1
      from public.sites s
     where s.id = p_site_id
       and s.organization_id = p_organization_id
       and coalesce(s.status,'active') <> 'deleted'
  ) then
    raise exception 'Site is outside the supplied company and organization.';
  end if;

  if not exists (
    select 1
      from public.vendors v
     where v.id = p_vendor_id
       and v.organization_id = p_organization_id
       and coalesce(v.status,'active') <> 'deleted'
  ) then
    raise exception 'Vendor is outside the supplied organization.';
  end if;

  if p_source_type = 'indent'
     and not exists (
       select 1
         from public.purchase_requisitions r
        where r.id=p_source_requisition_id
          and r.organization_id=p_organization_id
          and r.company_id=p_company_id
          and r.site_id=p_site_id
          and r.procurement_flow='billing_engineer'
     )
  then
    raise exception 'Approved Material Indent was not found in the selected scope.';
  end if;

  if nullif(p_fields->>'standard_terms_template_id', '') is null then
    raise exception 'A Standard Terms Set is required for the selected company.';
  end if;

  select jsonb_build_object(
           'template_id', x.id,
           'template_name', x.template_name,
           'clauses',
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', s.id,
                 'heading', s.heading,
                 'clause_body', s.clause_body,
                 'sort_order', s.sort_order
               )
               order by s.sort_order, s.id
             ) filter (where s.id is not null),
             '[]'::jsonb
           )
         )
    into v_terms_snapshot
    from public.company_po_terms_templates x
    left join public.company_po_terms_sections s
      on s.template_id = x.id
     and s.status = 'active'
   where x.id = nullif(p_fields->>'standard_terms_template_id', '')::uuid
     and x.organization_id = p_organization_id
     and x.company_id = p_company_id
     and x.status = 'active'
   group by x.id, x.template_name;

  if v_terms_snapshot is null then
    raise exception 'Selected Standard Terms Set is invalid for the selected company.';
  end if;

  if jsonb_typeof(
       coalesce(
         p_fields->'commercial'->'additional_charges',
         '[]'::jsonb
       )
     ) <> 'array'
  then
    raise exception 'Additional charges must be an array.';
  end if;

  for v_charge in
    select *
      from jsonb_array_elements(
        coalesce(
          p_fields->'commercial'->'additional_charges',
          '[]'::jsonb
        )
      )
  loop
    v_charge_name := nullif(trim(v_charge->>'name'),'');
    v_charge_amount := nullif(v_charge->>'amount','')::numeric;

    if v_charge_name is null
       or v_charge_amount is null
       or v_charge_amount < 0
    then
      raise exception 'Each additional charge needs a name and a valid non-negative amount.';
    end if;

    v_additional_charges :=
      v_additional_charges
      || jsonb_build_array(
           jsonb_build_object(
             'name', v_charge_name,
             'amount', v_charge_amount
           )
         );

    v_additional_total :=
      v_additional_total + v_charge_amount;
  end loop;

  v_delivery_snapshot :=
    coalesce(p_fields->'delivery','{}'::jsonb)
    || public.resolve_procurement_po_master_snapshot(
         p_organization_id,
         p_company_id,
         p_site_id,
         p_fields
       );

  insert into public.procurement_purchase_orders(
    organization_id,
    company_id,
    site_id,
    source_type,
    po_number,
    po_date,
    rfq_number_snapshot,
    source_requisition_id,
    source_requisition_number_snapshot,
    vendor_id,
    vendor_name_snapshot,
    vendor_snapshot,
    delivery_snapshot,
    commercial_snapshot,
    standard_terms_snapshot,
    template_id,
    template_version_id,
    template_snapshot,
    total_additional_charges_amount,
    total_basic_amount,
    total_gst_amount,
    total_amount,
    created_by,
    created_by_name,
    created_by_email,
    updated_by,
    updated_by_name,
    updated_by_email
  )
  values (
    p_organization_id,
    p_company_id,
    p_site_id,
    p_source_type,
    public.next_procurement_purchase_order_number(
      p_organization_id,
      p_company_id,
      coalesce(
        nullif(p_fields->>'po_date','')::date,
        current_date
      )
    ),
    coalesce(
      nullif(p_fields->>'po_date','')::date,
      current_date
    ),
    '',
    p_source_requisition_id,
    nullif(p_source_requisition_number,''),
    p_vendor_id,
    v_vendor_name,
    coalesce(p_vendor_snapshot,'{}'::jsonb),
    v_delivery_snapshot,
    jsonb_set(
      coalesce(p_fields->'commercial','{}'::jsonb),
      '{additional_charges}',
      v_additional_charges,
      true
    ),
    v_terms_snapshot::text,
    v_template_id,
    v_template_version_id,
    v_template_snapshot,
    v_additional_total,
    0,
    0,
    0,
    nullif(p_actor->>'user_id','')::uuid,
    p_actor->>'name',
    p_actor->>'email',
    nullif(p_actor->>'user_id','')::uuid,
    p_actor->>'name',
    p_actor->>'email'
  )
  returning * into v_po;

  for v_item in
    select *
      from jsonb_array_elements(p_items)
  loop
    v_has_master_item_id := v_item ? 'item_id';
    if v_has_master_item_id then
      if jsonb_typeof(v_item->'item_id') = 'null' then
        v_master_item_id := null;
      else
        begin
          v_master_item_id := nullif(v_item->>'item_id', '')::uuid;
        exception when invalid_text_representation then
          raise exception 'Invalid Item Master ID.';
        end;
        if v_master_item_id is null or not exists (
          select 1 from public.procurement_items i
          where i.id = v_master_item_id
            and i.organization_id = p_organization_id
            and i.status = 'active'
        ) then
          raise exception 'Selected Item Master record is invalid.';
        end if;
      end if;
    else
      select count(*) into v_count
      from public.procurement_items i
      where i.organization_id = p_organization_id
        and i.status = 'active'
        and nullif(btrim(i.item_code), '') is not null
        and i.item_code = nullif(btrim(v_item->>'item_code'), '');
      if v_count = 1 then
        select i.id into v_master_item_id
        from public.procurement_items i
        where i.organization_id = p_organization_id
          and i.status = 'active'
          and nullif(btrim(i.item_code), '') is not null
          and i.item_code = nullif(btrim(v_item->>'item_code'), '');
      else
        v_master_item_id := null;
      end if;
    end if;

    v_qty := (v_item->>'quantity')::numeric;
    v_unit := coalesce(
      nullif(v_item->>'unit_rate','')::numeric,
      0
    );
    v_gst_rate := coalesce(
      nullif(v_item->>'gst_rate','')::numeric,
      0
    );

    if v_qty is null or v_qty <= 0 then
      raise exception 'Item quantity must be greater than zero.';
    end if;

    if v_unit < 0 or v_gst_rate < 0 then
      raise exception 'Item rate and GST must be non-negative.';
    end if;

    if p_source_type = 'indent' then
      if nullif(
           v_item->>'source_requisition_line_key',
           ''
         ) is null
      then
        raise exception 'Indent PO items require a source line.';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended(
          p_source_requisition_id::text
          || ':'
          || (v_item->>'source_requisition_line_key'),
          0
        )
      );

      if not exists (
        select 1
          from public.purchase_requisition_items i
          join public.purchase_requisition_line_approval_state s
            on s.requisition_id = i.requisition_id
           and s.requisition_item_line_key = i.line_key
         where i.requisition_id = p_source_requisition_id
           and i.line_key =
             (v_item->>'source_requisition_line_key')::uuid
           and s.approval_status = 'approved'
           and s.current_approval_layer is null
      ) then
        raise exception 'Every Indent PO item must reference an approved Indent line.';
      end if;

      if coalesce(
           (
             select sum(
               coalesce(
                 nullif(x->>'quantity','')::numeric,
                 0
               )
             )
               from jsonb_array_elements(p_items) x
              where x->>'source_requisition_line_key' =
                    v_item->>'source_requisition_line_key'
           ),
           0
         )
         >
         coalesce(
           (
             select
               i.quantity
               - coalesce(
                   sum(poi.quantity)
                   filter (
                     where po.status <> 'rejected'
                   ),
                   0
                 )
               from public.purchase_requisition_items i
               left join public.procurement_purchase_order_items poi
                 on poi.source_requisition_id = i.requisition_id
                and poi.source_requisition_line_key = i.line_key
               left join public.procurement_purchase_orders po
                 on po.id = poi.purchase_order_id
              where i.requisition_id = p_source_requisition_id
                and i.line_key =
                  (v_item->>'source_requisition_line_key')::uuid
              group by i.quantity
           ),
           0
         )
      then
        raise exception 'Quantity exceeds the remaining approved Indent quantity.';
      end if;
    end if;

    v_taxable := round(v_qty * v_unit, 2);
    v_gst := round(v_taxable * v_gst_rate / 100, 2);
    v_total := v_taxable + v_gst;

    v_basic := v_basic + v_taxable;
    v_gst_total := v_gst_total + v_gst;
    v_total_amount := v_total_amount + v_total;

    insert into public.procurement_purchase_order_items(
      purchase_order_id,
      item_id,
      source_requisition_id,
      source_requisition_line_key,
      item_code_snapshot,
      item_name_snapshot,
      specification_snapshot,
      make_snapshot,
      quantity,
      uom_snapshot,
      unit_rate,
      gst_rate,
      taxable_amount,
      gst_amount,
      total_amount,
      remarks_snapshot,
      sort_order
    )
    values (
      v_po.id,
      v_master_item_id,
      p_source_requisition_id,
      nullif(
        v_item->>'source_requisition_line_key',
        ''
      )::uuid,
      nullif(v_item->>'item_code',''),
      nullif(v_item->>'item_name',''),
      nullif(v_item->>'specification',''),
      nullif(v_item->>'make',''),
      v_qty,
      coalesce(nullif(v_item->>'uom',''),'Nos'),
      v_unit,
      v_gst_rate,
      v_taxable,
      v_gst,
      v_total,
      nullif(v_item->>'remarks',''),
      coalesce(
        nullif(v_item->>'sort_order','')::integer,
        1
      )
    );
  end loop;

  update public.procurement_purchase_orders
     set total_basic_amount = v_basic,
         total_gst_amount = v_gst_total,
         total_additional_charges_amount = v_additional_total,
         total_amount = v_total_amount + v_additional_total
   where id = v_po.id;

  insert into public.procurement_purchase_order_events(
    purchase_order_id,
    event_type,
    actor_id,
    actor_name,
    actor_email,
    changes
  )
  values(
    v_po.id,
    'created_draft',
    nullif(p_actor->>'user_id','')::uuid,
    p_actor->>'name',
    p_actor->>'email',
    jsonb_build_object(
      'source_type',
      p_source_type,
      'master_selection',
      v_delivery_snapshot->'master_selection'
    )
  );

  return jsonb_build_object(
    'purchase_order_id',
    v_po.id,
    'po_number',
    v_po.po_number
  );
end;
$function$;

create or replace function public.update_procurement_purchase_order_draft_with_items_v2_atomic(
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
  v_po_item_id uuid;
  v_master_item_id uuid;
  v_has_master_item_id boolean;
  v_count integer;
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
    v_po_item_id := nullif(v_item->>'po_item_id', '')::uuid;
    v_has_master_item_id := v_item ? 'item_id';
    if v_has_master_item_id then
      if jsonb_typeof(v_item->'item_id') = 'null' then
        v_master_item_id := null;
      else
        begin
          v_master_item_id := nullif(v_item->>'item_id', '')::uuid;
        exception when invalid_text_representation then
          raise exception 'Invalid Item Master ID.';
        end;
        if v_master_item_id is null or not exists (
          select 1 from public.procurement_items i
          where i.id = v_master_item_id and i.organization_id = p_organization_id and i.status = 'active'
        ) then raise exception 'Selected Item Master record is invalid.'; end if;
      end if;
    elsif v_po_item_id is not null then
      select item_id into v_master_item_id from public.procurement_purchase_order_items
      where id = v_po_item_id and purchase_order_id = p_purchase_order_id;
    else
      select count(*) into v_count
      from public.procurement_items i
      where i.organization_id = p_organization_id and i.status = 'active'
        and nullif(btrim(i.item_code), '') is not null
        and i.item_code = nullif(btrim(v_item->>'item_code'), '');
      if v_count = 1 then
        select i.id into v_master_item_id
        from public.procurement_items i
        where i.organization_id = p_organization_id and i.status = 'active'
          and nullif(btrim(i.item_code), '') is not null
          and i.item_code = nullif(btrim(v_item->>'item_code'), '');
      else
        v_master_item_id := null;
      end if;
    end if;
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

    if v_po_item_id is not null then
      update public.procurement_purchase_order_items
      set item_id = v_master_item_id,
          item_code_snapshot = nullif(v_item->>'item_code', ''),
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
      where id = v_po_item_id and purchase_order_id = p_purchase_order_id;
      if not found then raise exception 'Purchase Order item was not found.'; end if;
    else
      insert into public.procurement_purchase_order_items(
        purchase_order_id, item_id, revision_line_key, source_requisition_id, source_requisition_line_key,
        item_code_snapshot, item_name_snapshot, specification_snapshot, make_snapshot,
        quantity, uom_snapshot, unit_rate, gst_rate, taxable_amount, gst_amount,
        total_amount, sort_order
      ) values (
        p_purchase_order_id, v_master_item_id, gen_random_uuid(),
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

revoke all on function public.populate_procurement_purchase_order_item_master_id() from public, anon, authenticated;
grant execute on function public.populate_procurement_purchase_order_item_master_id() to service_role;

revoke all on function public.create_procurement_purchase_order_draft_v2_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_procurement_purchase_order_draft_v2_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb) to authenticated, service_role;

revoke all on function public.update_procurement_purchase_order_draft_with_items_v2_atomic(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.update_procurement_purchase_order_draft_with_items_v2_atomic(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

commit;
