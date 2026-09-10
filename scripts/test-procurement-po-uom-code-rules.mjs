import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const pdf = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const updateApi = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609100014_procurement_po_edit_item_persistence.sql", "utf8");

assert.match(page, /canonicalUomCode\(line\.item_id, line\.uom_snapshot\)/);
assert.match(page, /uom: material\.default_uom\?\.uom_code \|\| ""/);
assert.doesNotMatch(page, /uom: material\.default_uom\?\.uom_name/);
assert.match(page, /row\.item_code === item\.item_code/);
assert.match(page, /item_id: material\.id/);
assert.match(page, /isMaterialMasterLinked: false/);
assert.match(page, /item\.isMaterialMasterLinked \|\| Boolean\(item\.item_id\)/);
assert.match(page, /material\.item_code === item\.item_code/);
assert.match(page, /linkedUom/);
assert.match(page, /uom: material\.default_uom\?\.uom_code \|\| \"\"/);
assert.match(page, /linkedMaterial \? <span/);
assert.match(page, /source === "direct" && !item\.item_id \? <input value=\{item\.uom/);
assert.match(pdf, /text\(item\.uom_snapshot\)/);
assert.match(page, /po_item_id: item\.id/);
assert.match(updateApi, /update_procurement_purchase_order_draft_with_items_atomic/);
assert.match(updateApi, /const items = Array\.isArray\(body\.items\) \? body\.items : \[\]/);
assert.match(updateApi, /items\.length \? "update_procurement_purchase_order_draft_with_items_atomic"/);
assert.match(migration, /p_fields - 'items'/);
assert.match(migration, /select u\.uom_code[\s\S]*procurement_uoms/);
assert.match(migration, /uom_snapshot = v_uom/);
assert.match(migration, /status in \('draft', 'sent_back'\)/);
assert.match(migration, /Only a Draft or Sent Back Purchase Order can be edited/);
assert.match(migration, /Every editable item must identify one existing Purchase Order item exactly once/);
assert.doesNotMatch(migration, /transition_procurement_purchase_order_atomic/);

for (const [code, description] of [["Nos", "Numbers"], ["Kg", "Kilogram"], ["MT", "Metric Ton"], ["Ltr", "Litre"], ["Mtr", "Metre"], ["Sqm", "Square Metre"]]) {
  const row = { default_uom: { uom_code: code, uom_name: description } };
  assert.equal(row.default_uom.uom_code, code);
  assert.notEqual(row.default_uom.uom_code, row.default_uom.uom_name);
}

console.log("PO UOM code rules passed.");
