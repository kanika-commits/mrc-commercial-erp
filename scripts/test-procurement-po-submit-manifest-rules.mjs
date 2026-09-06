import assert from "node:assert/strict";
import fs from "node:fs";

const baseline = fs.readFileSync("supabase/migrations/202609060001_procurement_purchase_orders_non_rfq_baseline.sql", "utf8");
const workflowMigration = fs.readFileSync("supabase/migrations/202609060005_procurement_purchase_orders_non_rfq_workflow_documents.sql", "utf8");
const securityMigration = fs.readFileSync("supabase/migrations/202609060006_procurement_purchase_orders_non_rfq_security.sql", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");

assert.match(workflowMigration, /transition_procurement_purchase_order_atomic\(/);
assert.match(workflowMigration, /d\.manifest_order/);
assert.match(workflowMigration, /row_number\(\) over/);
assert.match(workflowMigration, /jsonb_agg\(jsonb_build_object/);
assert.match(baseline, /supporting_documents_manifest/);
assert.match(securityMigration, /transition_procurement_purchase_order_atomic/);
assert.match(route, /p_action: action/);
assert.match(route, /loadFrozenSupportingDocuments/);
console.log("PO submit manifest rules passed.");
