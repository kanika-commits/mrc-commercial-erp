import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase/migrations/202609060005_procurement_purchase_orders_non_rfq_workflow_documents.sql", "utf8");
assert.equal((sql.match(/create or replace function public\./g) || []).length, 4);
for (const name of ["transition_procurement_purchase_order_atomic", "add_procurement_purchase_order_document_atomic", "remove_procurement_purchase_order_document_atomic", "reorder_procurement_purchase_order_documents_atomic"]) assert.match(sql, new RegExp(name));
for (const action of ["submit", "approve", "send_back", "reject", "issue"]) assert.match(sql, new RegExp(`'${action}'`));
assert.match(sql, /pending_approval/); assert.match(sql, /status not in \('draft','sent_back'\)/); assert.match(sql, /status <> 'pending_approval'/); assert.match(sql, /status <> 'approved'/);
assert.match(sql, /p_action='submit'/); assert.match(sql, /status='active'/); assert.match(sql, /manifest_order/); assert.match(sql, /included_in_pdf/); assert.match(sql, /submitted_by/); assert.match(sql, /approved_by/); assert.match(sql, /issued_by/); assert.match(sql, /event_note/);
assert.match(sql, /v_mime:=p_document->>'mime_type'/); assert.match(sql, /25\*1024\*1024/); assert.match(sql, /return jsonb_build_object\('id',v_row.id/);
assert.match(sql, /delete from public\.procurement_purchase_order_documents/); assert.match(sql, /count\(distinct x\)/); assert.match(sql, /set sort_order=v_index/); assert.match(sql, /'reordered',true/);
for (const forbidden of ["procurement_rfqs", "procurement_rfq_", "rfq_id", "rfq_vendor_id", "final_selection", "final_selection_id", "negotiation"]) assert.doesNotMatch(sql, new RegExp(forbidden));
console.log("Part 5 workflow and document RPC rules passed");
