import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609120003_procurement_po_revision_stage_b_create.sql", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/revision/route.ts", "utf8");

assert.match(migration, /create or replace function public\.create_procurement_purchase_order_revision_atomic/);
assert.match(migration, /security definer set search_path=public,pg_temp/);
assert.match(migration, /s\.status <> 'approved'/);
assert.match(migration, /A revision is already in progress/);
assert.match(migration, /source_document_id/);
assert.match(migration, /sd\.purchase_order_id=s\.id/);
assert.match(migration, /sd\.document_type not in \('signed_po','generated_po','approved_po'\)/);
assert.match(migration, /revision_family_id/);
assert.match(migration, /previous_revision_id/);
assert.match(migration, /'draft'/);
assert.match(migration, /revision_created/);
assert.match(migration, /revoke all on function public\.create_procurement_purchase_order_revision_atomic/);
assert.match(migration, /grant execute on function public\.create_procurement_purchase_order_revision_atomic.*to service_role/);

assert.match(route, /requireProcurementPermission\(request, "procurement_purchase_orders", "edit"\)/);
assert.match(route, /applyOrganizationAccess/);
assert.match(route, /applyCompanySiteAccess/);
assert.match(route, /copyObjectsWithCompensation/);
assert.match(route, /crypto\.randomUUID\(\)/);
assert.match(route, /signed_po.*generated_po.*approved_po/);
assert.match(route, /source_document_id: eligible\[i\]\.id/);
assert.match(route, /admin\.rpc\("create_procurement_purchase_order_revision_atomic"/);
assert.match(route, /copied\.reverse\(\)/);

console.log("PO revision Stage B rules: PASS");
