import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609080002_fix_procurement_po_company_neutral_site_resolver.sql",
  "utf8",
);

assert.match(migration, /resolve_procurement_po_master_snapshot\(\s*p_organization_id uuid,\s*p_company_id uuid,\s*p_site_id uuid,\s*p_fields jsonb\s*\)/s);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path TO 'public', 'pg_temp'/);
assert.match(migration, /public\.companies/);
assert.doesNotMatch(migration, /s\.company_id = p_company_id or s\.company_id is null/);
assert.match(migration, /s\.organization_id = p_organization_id/);
assert.match(migration, /coalesce\(s\.status, 'active'\) = 'active'/);
assert.match(migration, /public\.company_gst_registrations/);
assert.match(migration, /v_gst_count = 0/);
assert.match(migration, /v_gst_default_count = 1/);
assert.match(migration, /public\.company_billing_addresses/);
assert.match(migration, /gst_registration_id = v_gst\.id/);
assert.match(migration, /gst_registration_id is null/);
assert.match(migration, /public\.site_delivery_locations/);
assert.match(migration, /billing_address_id = v_billing\.id/);
assert.match(migration, /v_delivery_default_count = 1/);
assert.match(migration, /v_delivery_company_name/);
assert.match(migration, /billing_contact_id/);
assert.match(migration, /delivery_contact_id/);
assert.match(migration, /public\.site_contacts/);
assert.match(migration, /public\.procurement_company_letterheads/);
assert.match(migration, /public\.procurement_company_letterhead_versions/);
assert.match(migration, /l\.status = 'active'/);
assert.match(migration, /l\.is_default/);
assert.match(migration, /v\.version_status = 'ready'/);
assert.match(migration, /v\.header_content_hash is not null/);
assert.match(migration, /v\.footer_content_hash is not null/);
for (const key of [
  "master_selection", "gst_billing", "billing_address", "delivery_location",
  "site_contact", "delivery_contact", "billing_contact", "letterhead",
  "shipping_address",
]) assert.match(migration, new RegExp("'" + key + "'"));
assert.doesNotMatch(migration, /procurement_rfqs|procurement_rfq_|final_selection/);

console.log("Part 3 Purchase Order master resolver rules passed");
