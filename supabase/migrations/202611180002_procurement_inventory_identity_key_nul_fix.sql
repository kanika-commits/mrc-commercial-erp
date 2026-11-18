-- PostgreSQL text cannot contain the NUL character. Use a control separator that is
-- legal in text while preserving deterministic inventory identity keys.
create or replace function public.procurement_inventory_identity_key(
  p_material_item_id uuid,
  p_po_item_id uuid,
  p_uom text,
  p_make text,
  p_specification text
)
returns text
language sql
immutable
as $$
  select case when p_material_item_id is not null then 'master:' || p_material_item_id::text else 'po_item:' || p_po_item_id::text end
    || ':' || md5(coalesce(lower(btrim(p_uom)), '') || chr(31) || coalesce(lower(btrim(p_make)), '') || chr(31) || coalesce(lower(btrim(p_specification)), ''));
$$;
