import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const matrix = read("lib/permissionMatrix.ts");
const visibility = read("lib/permissionVisibility.ts");
const modulePage = read("components/ModulePage.tsx");
const appShell = read("components/AppShell.tsx");
const gst = read("app/api/procurement/purchase-orders/gst-registrations/route.ts");
const contacts = read("app/api/procurement/purchase-orders/site-contacts/route.ts");
const letterheads = read("app/api/procurement/purchase-orders/letterheads/route.ts");
const masterData = read("app/api/procurement/purchase-orders/master-data/route.ts");
const migration = read("supabase/migrations/202609070006_settings_po_master_permissions.sql");

for (const code of ["procurement_gst_billing_delivery_master", "procurement_site_contact_master", "procurement_letterhead_master", "procurement_po_terms_master"]) {
  assert.match(matrix, new RegExp(`${code}:`));
  assert.match(visibility, new RegExp(`${code}:`));
  assert.match(modulePage, new RegExp(code));
  assert.match(appShell, new RegExp(code));
  assert.match(migration, new RegExp(code));
}
assert.match(matrix, /procurement_gst_billing_delivery_master: \["view", "add", "edit"\]/);
assert.match(matrix, /procurement_site_contact_master: \["view", "add", "edit"\]/);
assert.match(matrix, /procurement_letterhead_master: \["view", "add", "edit", "delete"\]/);
assert.match(matrix, /procurement_po_terms_master: \["view", "add", "edit"\]/);
assert.match(gst, /requireProcurementPermission\(request, "procurement_gst_billing_delivery_master"/);
assert.match(contacts, /requireProcurementPermission\(request, "procurement_site_contact_master"/);
assert.match(letterheads, /const MODULE = "procurement_letterhead_master"/);
assert.match(masterData, /const GST_BILLING_MODULE = "procurement_gst_billing_delivery_master"/);
assert.match(masterData, /const TERMS_MODULE = "procurement_po_terms_master"/);
assert.match(masterData, /const MODULE = "procurement_purchase_orders"/);
assert.match(migration, /where not exists/);
assert.doesNotMatch(migration, /delete from|update public\.role_permissions|user_permissions/i);
assert.doesNotMatch(migration, /rfq|final_selection|inventory|vendor/i);
console.log("Settings master permission rules passed.");
