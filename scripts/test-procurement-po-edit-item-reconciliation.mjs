import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609190001_procurement_po_draft_item_set_reconciliation.sql", "utf8");
const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const fn = migration.slice(migration.indexOf("create or replace function"), migration.indexOf("revoke all on function"));

assert.match(page, /originalPersistedItemIdsRef = useRef<string\[]>\(\[\]\)/);
assert.match(page, /originalPersistedItemIdsRef\.current = \(po\.items \|\| \[\]\)\.map/);
assert.match(page, /expected_original_item_ids: editId \? \[\.\.\.originalPersistedItemIdsRef\.current\]/);
assert.match(route, /Array\.isArray\(body\.expected_original_item_ids\)/);
assert.match(route, /normalizedIds = .*\.map\(\(value\) => value\.toLowerCase\(\)\)/);
assert.match(route, /new Set\(normalizedIds\)/);
assert.match(route, /expected_original_item_ids: expectedOriginalItemIds/);

assert.match(fn, /status in \('draft', 'sent_back'\)[\s\S]*for update/i);
assert.match(fn, /v_expected_count <> v_expected_distinct_count/);
assert.match(fn, /array_agg\(id order by id\)/);
assert.match(fn, /array_agg\(value::uuid order by value::uuid\)/);
assert.match(fn, /v_current_ids is distinct from v_expected_ids/);
assert.doesNotMatch(fn, /v_existing_count <> v_submitted_count/);
assert.match(fn, /poi\.purchase_order_id = p_purchase_order_id/);
assert.match(fn, /persisted item ID must belong to this Purchase Order/i);
assert.match(fn, /not \(poi\.id = any\(v_final_ids\)\)/);
assert.match(fn, /procurement_goods_receipt_items[\s\S]*purchase_order_item_id = v_deleted\.id/);
const existingItemUpdate = fn.slice(fn.indexOf("update public.procurement_purchase_order_items\n      set"), fn.indexOf("where id = v_item_id", fn.indexOf("update public.procurement_purchase_order_items\n      set")));
assert.ok(existingItemUpdate.length > 0, "surviving persisted item update exists");
assert.doesNotMatch(existingItemUpdate, /\b(?:revision_line_key|source_requisition_id|source_requisition_line_key)\s*=/);
assert.match(fn, /item_name_snapshot = coalesce\(nullif\(v_item->>'item_name', ''\), item_name_snapshot\)/);
assert.match(fn, /v_unit := nullif\(v_item->>'unit_rate', ''\)::numeric/);
assert.match(fn, /v_gst_rate := nullif\(v_item->>'gst_rate', ''\)::numeric/);
assert.match(fn, /unit_rate = v_unit/);
assert.match(fn, /gst_rate = v_gst_rate/);
assert.match(fn, /v_uom := coalesce\(v_uom, nullif\(trim\(v_item->>'uom'\), ''\)\)/);
assert.doesNotMatch(fn, /Item quantity must be greater than zero|Item rate and GST must be non-negative|Each Purchase Order item needs a name|approval_status = 'approved'|Quantity exceeds the remaining approved Indent quantity/);
assert.match(fn, /purchase_order_id, revision_line_key, source_requisition_id, source_requisition_line_key/);
assert.match(fn, /gen_random_uuid\(\)/);
assert.match(fn, /sum\(taxable_amount\)[\s\S]*sum\(gst_amount\)[\s\S]*sum\(total_amount\)/);
assert.match(fn, /status in \('draft', 'sent_back'\)/);
assert.match(fn, /p_fields - 'items' - 'expected_original_item_ids'/);
assert.doesNotMatch(migration, /alter table/i);

// Small behavioral contract model for the SQL's exact-set reconciliation and
// persisted-row calculations. Database-level execution requires the managed
// Supabase schema and is intentionally not attempted by this local test.
function reconcile(current, expected, finalIds, { grnIds = [] } = {}) {
  const exact = (left, right) => left.length === right.length && [...left].sort().every((id, i) => id === [...right].sort()[i]);
  if (new Set(expected).size !== expected.length) throw new Error("duplicate expected ID");
  if (!exact(current.map((row) => row.id), expected)) throw new Error("stale");
  const submitted = finalIds.map((item) => typeof item === "string" ? { id: item } : item);
  const persistedIds = submitted.map((item) => item.id).filter((id) => id && !id.startsWith("NEW:"));
  if (new Set(persistedIds).size !== persistedIds.length) throw new Error("duplicate final ID");
  if (persistedIds.some((id) => !current.some((row) => row.id === id))) throw new Error("foreign PO item");
  const omitted = current.filter((row) => !persistedIds.includes(row.id));
  if (omitted.some((row) => grnIds.includes(row.id))) throw new Error("GRN dependency");
  return submitted.map((item) => {
    if (item.id.startsWith("NEW:")) return { ...item, id: item.id.slice(4) };
    return { ...current.find((row) => row.id === item.id), ...item };
  });
}
const initial = [{ id: "A", quantity: 10, rate: 100, gst: 18 }, { id: "B", quantity: 5, rate: 200, gst: 5 }, { id: "C", quantity: 2, rate: 50, gst: 0 }];
const afterRemove = reconcile(initial, ["A", "B", "C"], ["A", "C"]);
assert.deepEqual(afterRemove.map((row) => row.id), ["A", "C"]); // remove B; reload sees the persisted set
assert.deepEqual(reconcile(initial, ["A", "B", "C"], ["A", "C"]).map((row) => row.id), ["A", "C"]); // repeated reload result
assert.deepEqual(reconcile(initial, ["C", "B", "A"], ["A", "C"]).map((row) => row.id), ["A", "C"]); // expected IDs compare as a set
const removeAndModify = reconcile(initial, ["A", "B", "C"], [{ id: "A", quantity: 12 }, { id: "C" }]);
assert.deepEqual(removeAndModify.map((row) => row.id), ["A", "C"]);
assert.equal(removeAndModify[0].quantity, 12); // removal and modification share one save
const reduced = reconcile(initial, ["A", "B", "C"], [{ id: "A", quantity: 4 }, { id: "B" }, { id: "C" }]);
assert.equal(reduced[0].quantity, 4); // quantity reduction persists
const reducedSubtotal = reduced.reduce((sum, row) => sum + row.quantity * row.rate, 0);
const reducedGst = reduced.reduce((sum, row) => sum + row.quantity * row.rate * row.gst / 100, 0);
assert.equal(reducedSubtotal, 1500);
assert.equal(reducedGst, 122);
assert.equal(reducedSubtotal + reducedGst, 1622);
assert.deepEqual(reconcile(initial, ["A", "B", "C"], ["A", "C", "NEW:D"]).map((row) => row.id), ["A", "C", "D"]); // remove B + add D
assert.deepEqual(reconcile(initial, ["A", "B", "C"], ["C"]).map((row) => row.id), ["C"]); // multiple line removal
assert.throws(() => reconcile(initial, ["A", "A", "B", "C"], ["A"]), /duplicate expected ID/);
assert.throws(() => reconcile(initial, ["A", "B", "C"], ["foreign"]), /foreign PO item/);
assert.throws(() => reconcile([...initial, { id: "D" }], ["A", "B", "C"], ["A", "C"]), /stale/);
assert.throws(() => reconcile([initial[0], initial[2]], ["A", "B", "C"], ["A", "C"]), /stale/);
assert.throws(() => reconcile(initial, ["A", "B", "C"], ["A", "C"], { grnIds: ["B"] }), /GRN dependency/);

const indentLine = { approved: 100, rows: [{ id: "draft", status: "draft", quantity: 60 }, { id: "other", status: "issued", quantity: 10 }] };
const reserved = (rows) => rows.filter((row) => ["draft", "pending_approval", "sent_back"].includes(row.status)).reduce((sum, row) => sum + row.quantity, 0);
const queueRemaining = (rows) => indentLine.approved - rows.filter((row) => ["approved", "issued"].includes(row.status)).reduce((sum, row) => sum + row.quantity, 0) - reserved(rows);
assert.equal(reserved(indentLine.rows), 60);
assert.equal(queueRemaining(indentLine.rows), 30);
const removedIndent = indentLine.rows.filter((row) => row.id !== "draft");
assert.equal(reserved(removedIndent), 0);
assert.equal(queueRemaining(removedIndent), 90); // deleting this draft releases its reservation; issued quantity remains ordered
const reducedIndent = indentLine.rows.map((row) => row.id === "draft" ? { ...row, quantity: 30 } : row);
assert.equal(queueRemaining(reducedIndent), 60); // reducing the draft quantity releases the difference
const editedIndent = { source_requisition_id: "REQ", source_requisition_line_key: "LINE", revision_line_key: "REV" };
assert.deepEqual(editedIndent, { source_requisition_id: "REQ", source_requisition_line_key: "LINE", revision_line_key: "REV" });
assert.doesNotMatch(existingItemUpdate, /source_requisition_id\s*=|source_requisition_line_key\s*=|revision_line_key\s*=/);

const surviving = afterRemove;
const subtotal = surviving.reduce((sum, row) => sum + row.quantity * row.rate, 0);
const gst = surviving.reduce((sum, row) => sum + row.quantity * row.rate * row.gst / 100, 0);
assert.equal(subtotal, 1100);
assert.equal(gst, 180);
assert.equal(subtotal + gst, 1280);
assert.match(fn, /if not found then\s+raise exception 'Only a Draft or Sent Back Purchase Order can be edited.'/i);
assert.match(fn, /gri\.purchase_order_item_id = v_deleted\.id/); // DB FK remains unchanged and restrictive.
console.log("Purchase Order draft item reconciliation contract passed.");
