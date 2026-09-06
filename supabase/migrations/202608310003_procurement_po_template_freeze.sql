-- Freeze the selected PO template and company terms inside the existing draft transaction.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.create_procurement_purchase_order_draft_atomic(text,uuid,uuid,uuid,uuid,jsonb,uuid,text,jsonb,jsonb,jsonb)')) into v_definition;
  if v_definition is null then
    raise exception 'Expected Purchase Order draft RPC was not found.';
  end if;
  if position('v_vendor_name text := nullif(trim(p_vendor_snapshot->>''vendor_name''), '''');' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC declaration anchor was not found.';
  end if;
  v_definition := replace(v_definition,
    'v_vendor_name text := nullif(trim(p_vendor_snapshot->>''vendor_name''), '''');',
    'v_vendor_name text := nullif(trim(p_vendor_snapshot->>''vendor_name''), '''');
  v_template_id uuid;
  v_template_version_id uuid;
  v_template_snapshot jsonb;
  v_terms_snapshot jsonb;');
  if position('begin
  if p_source_type not in' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC validation anchor was not found.';
  end if;
  v_definition := replace(v_definition,
    'begin
  if p_source_type not in',
    'begin
  select t.id, v.id, jsonb_build_object(''template_id'', t.id, ''template_version_id'', v.id, ''template_name'', t.template_name, ''template_code'', t.template_code, ''version_number'', v.version_number, ''layout_definition'', v.layout_definition, ''header_asset_reference'', v.header_asset_reference, ''footer_asset_reference'', v.footer_asset_reference, ''source_original_filename'', v.source_original_filename)
    into v_template_id, v_template_version_id, v_template_snapshot
    from public.procurement_purchase_order_templates t
    join public.procurement_purchase_order_template_versions v on v.template_id = t.id
   where t.organization_id = p_organization_id and t.company_id = p_company_id
     and t.status = ''active'' and t.is_default
     and v.status = ''active'' and v.readiness_status = ''ready''
   order by v.version_number desc, v.id desc
   limit 1
   for update of t, v;
  if v_template_id is null then raise exception ''No Ready default Purchase Order template is configured for the selected company.''; end if;
  if nullif(p_fields->>''standard_terms_template_id'', '''') is null then raise exception ''A Standard Terms Set is required for the selected company.''; end if;
  select jsonb_build_object(''template_id'', x.id, ''template_name'', x.template_name, ''clauses'', coalesce(jsonb_agg(jsonb_build_object(''id'', s.id, ''heading'', s.heading, ''clause_body'', s.clause_body, ''sort_order'', s.sort_order) order by s.sort_order, s.id) filter (where s.id is not null), ''[]''::jsonb))
    into v_terms_snapshot
    from public.company_po_terms_templates x
    left join public.company_po_terms_sections s on s.template_id = x.id and s.status = ''active''
   where x.id = nullif(p_fields->>''standard_terms_template_id'', '''')::uuid
     and x.organization_id = p_organization_id and x.company_id = p_company_id and x.status = ''active''
   group by x.id, x.template_name;
  if v_terms_snapshot is null then raise exception ''Selected Standard Terms Set is invalid for the selected company.''; end if;
  if p_source_type not in');
  if position('vendor_snapshot, delivery_snapshot,
    commercial_snapshot, standard_terms_snapshot, total_basic_amount,' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC insert-column anchor was not found.';
  end if;
  v_definition := replace(v_definition,
    'vendor_snapshot, delivery_snapshot,
    commercial_snapshot, standard_terms_snapshot, total_basic_amount,',
    'vendor_snapshot, delivery_snapshot,
    commercial_snapshot, standard_terms_snapshot, template_id, template_version_id, template_snapshot, total_basic_amount,');
  if position('coalesce(p_fields->''delivery'',''{}''::jsonb), coalesce(p_fields->''commercial'',''{}''::jsonb),' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC insert-value anchor was not found.';
  end if;
  v_definition := replace(v_definition,
    'coalesce(p_fields->''delivery'',''{}''::jsonb), coalesce(p_fields->''commercial'',''{}''::jsonb),
    coalesce(p_fields->>''standard_terms'',''''), 0, 0, 0,',
    'coalesce(p_fields->''delivery'',''{}''::jsonb), coalesce(p_fields->''commercial'',''{}''::jsonb),
    v_terms_snapshot::text, v_template_id, v_template_version_id, v_template_snapshot, 0, 0, 0,');
  if position('v_terms_snapshot::text, v_template_id, v_template_version_id, v_template_snapshot' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC template value mapping was not applied.';
  end if;
  if position('v_template_id uuid;' in v_definition) = 0
     or position('v_template_version_id uuid;' in v_definition) = 0
     or position('v_template_snapshot jsonb;' in v_definition) = 0
     or position('v_terms_snapshot jsonb;' in v_definition) = 0
     or position('v.readiness_status = ''ready''' in v_definition) = 0
     or position('t.organization_id = p_organization_id' in v_definition) = 0
     or position('t.company_id = p_company_id' in v_definition) = 0
     or position('t.status = ''active'' and t.is_default' in v_definition) = 0
     or position('v.status = ''active''' in v_definition) = 0
     or position('No Ready default Purchase Order template is configured' in v_definition) = 0
     or position('Selected Standard Terms Set is invalid for the selected company.' in v_definition) = 0
     or position('commercial_snapshot, standard_terms_snapshot, template_id, template_version_id, template_snapshot' in v_definition) = 0
     or position('coalesce(p_fields->''commercial'',''{}''::jsonb)' in v_definition) = 0 then
    raise exception 'Purchase Order draft RPC freeze behavior verification failed.';
  end if;
  execute v_definition;
end $$;
