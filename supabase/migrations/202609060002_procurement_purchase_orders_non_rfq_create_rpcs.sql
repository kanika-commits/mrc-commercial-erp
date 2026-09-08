-- Part 2: clean-install PO numbering, Direct/Indent draft creation, and idempotency.
-- The master snapshot resolver is intentionally supplied by Part 3.

CREATE OR REPLACE FUNCTION public.next_procurement_purchase_order_number(
  p_organization_id uuid,
  p_company_id uuid,
  p_po_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_key text := to_char(coalesce(p_po_date,current_date), 'YYYY-MM');
  v_number integer;
  v_code text;
begin
  insert into public.procurement_purchase_order_sequences(
    organization_id,
    company_id,
    year_month,
    next_number
  )
  values(
    p_organization_id,
    p_company_id,
    v_key,
    2
  )
  on conflict (organization_id,company_id,year_month)
  do update
     set next_number =
       public.procurement_purchase_order_sequences.next_number + 1
  returning next_number - 1 into v_number;

  select coalesce(company_code, company_name, 'COMPANY')
    into v_code
    from public.companies
   where id=p_company_id;

  return
    upper(regexp_replace(v_code,'[^A-Za-z0-9]+','','g'))
    || '/'
    || upper(to_char(coalesce(p_po_date,current_date),'MON'))
    || '/'
    || to_char(coalesce(p_po_date,current_date),'YYYY')
    || '/'
    || lpad(v_number::text,4,'0')
    || '/R-0';
end;
$function$;

==================================================
2. DRAFT CREATION — EXACT LIVE BODY
==================================================

CREATE OR REPLACE FUNCTION public.create_procurement_purchase_order_draft_atomic(
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

==================================================
3. IDEMPOTENT WRAPPER — EXACT LIVE BODY
==================================================

CREATE OR REPLACE FUNCTION public.create_procurement_purchase_order_draft_idempotent_atomic(
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
  p_actor jsonb,
  p_creation_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_existing public.procurement_purchase_orders%rowtype;
  v_result jsonb;
  v_created_id uuid;
begin
  if p_creation_request_id is null then
    raise exception 'Creation request ID is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text
      || ':'
      || p_creation_request_id::text,
      0
    )
  );

  select *
    into v_existing
    from public.procurement_purchase_orders
   where organization_id = p_organization_id
     and creation_request_id = p_creation_request_id
   for update;

  if found then
    if v_existing.source_type <> p_source_type
       or v_existing.company_id <> p_company_id
       or v_existing.site_id <> p_site_id
       or v_existing.vendor_id <> p_vendor_id
       or v_existing.source_requisition_id
          is distinct from p_source_requisition_id
    then
      raise exception 'Creation request token does not match the original Purchase Order scope.';
    end if;

    return jsonb_build_object(
      'purchase_order_id',
      v_existing.id,
      'po_number',
      v_existing.po_number,
      'idempotent',
      true
    );
  end if;

  v_result :=
    public.create_procurement_purchase_order_draft_atomic(
      p_source_type,
      p_organization_id,
      p_company_id,
      p_site_id,
      p_vendor_id,
      p_vendor_snapshot,
      p_source_requisition_id,
      p_source_requisition_number,
      p_items,
      p_fields,
      p_actor
    );

  v_created_id :=
    nullif(
      v_result->>'purchase_order_id',
      ''
    )::uuid;

  update public.procurement_purchase_orders
     set creation_request_id = p_creation_request_id
   where id = v_created_id
     and organization_id = p_organization_id
     and creation_request_id is null;

  if not found then
    raise exception 'Purchase Order idempotency token could not be stored.';
  end if;

  return v_result
         || jsonb_build_object(
              'idempotent',
              false
            );
end;
$function$;
