import assert from "node:assert/strict";
import fs from "node:fs";

const grn = fs.readFileSync("supabase/migrations/202609070002_store_grn_workflow_baseline.sql", "utf8");
const inventory = fs.readFileSync("supabase/migrations/202609070003_store_inventory_material_issue_baseline.sql", "utf8");

for (const trigger of [
  "trg_lock_finalized_goods_receipts",
  "trg_lock_finalized_goods_receipt_items",
  "trg_lock_finalized_goods_receipt_documents",
  "trg_lock_finalized_goods_receipt_values",
]) assert.match(grn, new RegExp(`create trigger ${trigger}[\\s\\S]*before`));
assert.match(grn, /old\.status = 'finalized'[\s\S]*Finalized Goods Receipt Notes are immutable/);
assert.match(grn, /Evidence and verified values on finalized Goods Receipt Notes are immutable/);
assert.match(grn, /if tg_op = 'DELETE' then return old; end if;[\s\S]*return new/);
assert.match(inventory, /create trigger trg_prevent_procurement_inventory_movement_mutation[\s\S]*before update or delete/);
assert.match(inventory, /Inventory movement ledger is immutable/);
for (const trigger of ["trg_lock_finalized_material_issues", "trg_lock_finalized_material_issue_items"]) {
  assert.match(inventory, new RegExp(`create trigger ${trigger}[\\s\\S]*before`));
}
assert.match(inventory, /Finalized Material Issues are immutable/);

console.log("Store immutability rules: PASS");
