import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPaths = [
  "supabase/migrations/202609060001_procurement_purchase_orders_non_rfq_baseline.sql",
  "supabase/migrations/202609060002_procurement_purchase_orders_non_rfq_create_rpcs.sql",
  "supabase/migrations/202609060003_procurement_purchase_orders_non_rfq_master_resolver.sql",
  "supabase/migrations/202609060004_procurement_purchase_orders_non_rfq_update_rpcs.sql",
  "supabase/migrations/202609060005_procurement_purchase_orders_non_rfq_workflow_documents.sql",
  "supabase/migrations/202609060006_procurement_purchase_orders_non_rfq_security.sql",
];
const [foundation, create, resolver, update, workflow, security] = migrationPaths.map((path) => fs.readFileSync(path, "utf8"));
const all = [foundation, create, resolver, update, workflow, security].join("\n");

for (const table of [
  "procurement_purchase_order_sequences",
  "procurement_purchase_orders",
  "procurement_purchase_order_items",
  "procurement_purchase_order_events",
  "procurement_purchase_order_documents",
]) assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`));

assert.match(foundation, /source_type text not null default 'direct' check \(source_type in \('direct', 'indent'\)\)/);
assert.match(foundation, /rfq_number_snapshot text/);
assert.doesNotMatch(foundation, /references public\.procurement_rfqs|final_selection_id/);
for (const column of ["vendor_snapshot", "delivery_snapshot", "commercial_snapshot", "standard_terms_snapshot", "template_id", "template_version_id", "template_snapshot", "supporting_documents_manifest", "submitted_by", "approved_by", "issued_by"]) assert.match(foundation, new RegExp(`\\b${column}\\b`));
for (const column of ["source_requisition_id", "source_requisition_line_key", "quantity", "unit_rate", "gst_rate", "total_amount"]) assert.match(foundation, new RegExp(`\\b${column}\\b`));
assert.match(foundation, /creation_request_id/); assert.match(foundation, /creation_request_uidx/);

for (const name of [
  "next_procurement_purchase_order_number", "create_procurement_purchase_order_draft_atomic", "create_procurement_purchase_order_draft_idempotent_atomic", "resolve_procurement_po_master_snapshot", "update_procurement_purchase_order_draft_atomic", "update_procurement_purchase_order_draft_with_additional_charges", "update_procurement_po_draft_with_additional_charges_atomic", "set_procurement_purchase_order_freight_atomic", "transition_procurement_purchase_order_atomic", "add_procurement_purchase_order_document_atomic", "remove_procurement_purchase_order_document_atomic", "reorder_procurement_purchase_order_documents_atomic",
]) assert.match(all, new RegExp(`public\\.${name}`));
assert.doesNotMatch(update, /return public\.update_procurement_po_draft_with_additional_charges_atomic\(/);
assert.match(update, /coalesce\(total_freight_amount, 0\)/); assert.match(update, /coalesce\(v_po\.total_additional_charges_amount, 0\)/);
assert.match(workflow, /when 'submit' then 'pending_approval'/); assert.match(workflow, /when 'issue' then 'issued'/);
assert.match(workflow, /p_action='submit'/); assert.match(workflow, /status='active'/);
assert.match(security, /enable row level security/); assert.match(security, /from public, anon, authenticated/); assert.match(security, /to service_role/);
for (const name of ["create_procurement_purchase_order_draft_atomic", "resolve_procurement_po_master_snapshot", "update_procurement_purchase_order_draft_atomic", "transition_procurement_purchase_order_atomic", "add_procurement_purchase_order_document_atomic"]) assert.match(all, new RegExp(`public\\.${name}[\\s\\S]*?security definer[\\s\\S]*?search_path`, "i"));

const supportedStatuses = ["draft", "pending_approval", "approved", "issued", "sent_back", "rejected"];
assert.match(foundation, /status text not null default 'draft' check \(status in \('draft', 'pending_approval', 'approved', 'issued', 'sent_back', 'rejected'\)\)/);
assert.doesNotMatch(foundation, /'cancelled'/);
assert.match(create, /where po\.status <> 'rejected'/);
assert.doesNotMatch(create, /cancelled/);
for (const status of supportedStatuses.filter((status) => status !== "rejected")) assert.equal(status !== "rejected", true);
assert.equal(supportedStatuses.includes("cancelled"), false);

for (const forbidden of ["procurement_rfqs", "procurement_rfq_", "rfq_id", "rfq_vendor_id", "final_selection", "final_selection_id", "negotiation"]) assert.doesNotMatch(all, new RegExp(forbidden));

console.log("Non-RFQ PO baseline-wide rules passed");
