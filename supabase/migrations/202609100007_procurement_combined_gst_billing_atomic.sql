-- Keep the combined GST / Billing & Delivery master aligned with the
-- company GST registration relationship used by Purchase Orders.
create or replace function public.save_procurement_combined_gst_billing_atomic(
  p_organization_id uuid,
  p_parent_id uuid,
  p_parent jsonb,
  p_contacts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_parent->>'company_id', '')::uuid;
  v_gstin text := upper(btrim(coalesce(p_parent->>'gstin', '')));
  v_gst_id uuid;
  v_existing public.company_gst_registrations%rowtype;
begin
  if v_gstin = '' then
    raise exception 'GSTIN is required.';
  end if;

  select * into v_existing
    from public.company_gst_registrations
   where organization_id = p_organization_id
     and company_id = v_company_id
     and upper(btrim(gstin)) = v_gstin
   limit 1;

  if v_existing.id is not null then
    v_gst_id := public.save_company_gst_registration_atomic(
      p_organization_id,
      v_existing.id,
      v_company_id,
      v_gstin,
      coalesce(nullif(btrim(p_parent->>'legal_name'), ''), v_existing.legal_name),
      coalesce(nullif(btrim(p_parent->>'trade_name'), ''), v_existing.trade_name),
      coalesce(nullif(btrim(p_parent->>'state'), ''), v_existing.state),
      coalesce(nullif(btrim(p_parent->>'state_code'), ''), v_existing.state_code),
      coalesce(nullif(btrim(p_parent->>'registration_type'), ''), v_existing.registration_type),
      v_existing.effective_from,
      v_existing.effective_to,
      v_existing.is_default,
      v_existing.status
    );
  else
    v_gst_id := public.save_company_gst_registration_atomic(
      p_organization_id,
      null,
      v_company_id,
      v_gstin,
      nullif(btrim(p_parent->>'legal_name'), ''),
      nullif(btrim(p_parent->>'trade_name'), ''),
      nullif(btrim(p_parent->>'state'), ''),
      nullif(btrim(p_parent->>'state_code'), ''),
      nullif(btrim(p_parent->>'registration_type'), ''),
      null,
      null,
      coalesce((p_parent->>'is_default')::boolean, false),
      coalesce(nullif(p_parent->>'status', ''), 'active')
    );
  end if;

  return public.save_procurement_billing_address_with_gst_atomic(
    p_organization_id,
    p_parent_id,
    p_parent || jsonb_build_object('company_id', v_company_id, 'gst_registration_id', v_gst_id),
    p_contacts
  );
end;
$$;

revoke all on function public.save_procurement_combined_gst_billing_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_procurement_combined_gst_billing_atomic(uuid, uuid, jsonb, jsonb) to service_role;
