import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/master-data/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609100007_procurement_combined_gst_billing_atomic.sql", "utf8");
const resolver = fs.readFileSync("supabase/migrations/202609060003_procurement_purchase_orders_non_rfq_master_resolver.sql", "utf8");

assert.match(route, /save_procurement_combined_gst_billing_atomic/);
assert.match(migration, /save_company_gst_registration_atomic/);
assert.match(migration, /save_procurement_billing_address_with_gst_atomic/);
assert.match(migration, /p_parent_id/);
assert.match(migration, /gst_registration_id', v_gst_id/);
assert.match(migration, /organization_id = p_organization_id/);
assert.match(migration, /company_id = v_company_id/);
assert.match(migration, /grant execute .*service_role/si);
assert.doesNotMatch(migration, /insert into public\.company_billing_addresses/);
assert.doesNotMatch(migration, /delete from public\.(company_gst_registrations|company_billing_addresses)/i);
assert.match(resolver, /from public\.company_gst_registrations/);
assert.match(resolver, /billing_address_id = v_billing\.id/);
assert.doesNotMatch(migration, /202609100006|MRC|GLC|Pushpa/i);
console.log("Combined GST / Billing save rules passed.");
