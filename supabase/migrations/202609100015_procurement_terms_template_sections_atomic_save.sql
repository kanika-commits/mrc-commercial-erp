create or replace function public.save_procurement_terms_template_with_sections_atomic(
  p_organization_id uuid,
  p_template_id uuid,
  p_company_id uuid,
  p_template_name text,
  p_is_default boolean,
  p_status text,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template_id uuid := p_template_id;
  v_section jsonb;
  v_section_id uuid;
  v_submitted_ids uuid[] := array[]::uuid[];
  v_company public.companies%rowtype;
  v_template public.company_po_terms_templates%rowtype;
begin
  if p_company_id is null or nullif(btrim(coalesce(p_template_name, '')), '') is null then
    raise exception 'Company and template name are required.';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'Terms sections must be an array.';
  end if;

  select * into v_company
    from public.companies
   where id = p_company_id
     and organization_id = p_organization_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'Company is not active or does not belong to the selected organization.';
  end if;

  if v_template_id is null then
    insert into public.company_po_terms_templates
      (organization_id, company_id, template_name, is_default, status)
    values
      (p_organization_id, p_company_id, btrim(p_template_name), coalesce(p_is_default, false), coalesce(nullif(p_status, ''), 'active'))
    returning * into v_template;
    v_template_id := v_template.id;
  else
    select * into v_template
      from public.company_po_terms_templates
     where id = v_template_id
       and organization_id = p_organization_id
       and company_id = p_company_id
     for update;
    if not found then
      raise exception 'Terms template is outside the selected organization or company.';
    end if;
    update public.company_po_terms_templates
       set template_name = btrim(p_template_name),
           is_default = coalesce(p_is_default, false),
           status = coalesce(nullif(p_status, ''), status)
     where id = v_template_id;
  end if;

  if coalesce(p_is_default, false) then
    update public.company_po_terms_templates
       set is_default = false
     where organization_id = p_organization_id
       and company_id = p_company_id
       and status = 'active'
       and id <> v_template_id;
  end if;

  for v_section in select value from jsonb_array_elements(p_sections)
  loop
    if nullif(btrim(coalesce(v_section->>'heading', '')), '') is null
       or nullif(btrim(coalesce(v_section->>'clause_body', '')), '') is null then
      raise exception 'Every terms section requires a heading and clause body.';
    end if;
    v_section_id := nullif(v_section->>'id', '')::uuid;
    if v_section_id is not null then
      if not exists (select 1 from public.company_po_terms_sections where id = v_section_id and template_id = v_template_id) then
        raise exception 'Terms section does not belong to the selected template.';
      end if;
      v_submitted_ids := array_append(v_submitted_ids, v_section_id);
      update public.company_po_terms_sections
         set heading = btrim(v_section->>'heading'),
             clause_body = v_section->>'clause_body',
             sort_order = coalesce((v_section->>'sort_order')::integer, 0),
             status = coalesce(nullif(v_section->>'status', ''), 'active')
       where id = v_section_id and template_id = v_template_id;
    else
      insert into public.company_po_terms_sections
        (template_id, heading, clause_body, sort_order, status)
      values
        (v_template_id, btrim(v_section->>'heading'), v_section->>'clause_body', coalesce((v_section->>'sort_order')::integer, 0), coalesce(nullif(v_section->>'status', ''), 'active'))
      returning id into v_section_id;
      v_submitted_ids := array_append(v_submitted_ids, v_section_id);
    end if;
  end loop;

  if cardinality(v_submitted_ids) > 0 then
    delete from public.company_po_terms_sections
     where template_id = v_template_id and id <> all(v_submitted_ids);
  else
    delete from public.company_po_terms_sections where template_id = v_template_id;
  end if;

  return jsonb_build_object('id', v_template_id);
end;
$$;

revoke all on function public.save_procurement_terms_template_with_sections_atomic(uuid, uuid, uuid, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_procurement_terms_template_with_sections_atomic(uuid, uuid, uuid, text, boolean, text, jsonb) to service_role;
