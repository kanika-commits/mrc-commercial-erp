import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync("supabase/migrations/202609070002_store_grn_workflow_baseline.sql", "utf8");
const inventory = fs.readFileSync("supabase/migrations/202609070003_store_inventory_material_issue_baseline.sql", "utf8");

assert.match(workflow, /from public\.procurement_goods_receipts[\s\S]*for update/);
assert.match(workflow, /v_grn\.status <> 'draft'/);
assert.match(workflow, /from public\.procurement_purchase_orders[\s\S]*for update/);
assert.match(workflow, /gh\.status = 'finalized'/);
assert.match(workflow, /v_accepted \+ v_item\.accepted_quantity > v_item\.ordered_quantity/);
assert.match(inventory, /old\.status is distinct from new\.status and new\.status = 'finalized'/);
assert.match(inventory, /on conflict \(source_type, source_item_id, movement_type\) do nothing returning id into v_movement_id/);
assert.match(inventory, /if v_movement_id is not null then[\s\S]*quantity_on_hand = quantity_on_hand \+ r\.accepted_quantity/);
assert.match(inventory, /from public\.procurement_inventory_balances[\s\S]*for update/);
assert.match(inventory, /from public\.procurement_material_issues where id = p_issue_id for update/);
assert.match(inventory, /order by b\.id, ii\.id[\s\S]*for update of b/);
assert.match(inventory, /i\.quantity_on_hand < i\.issue_quantity/);
assert.match(inventory, /on conflict \(source_type, source_item_id, movement_type\) do nothing returning id into v_movement_id/);
assert.match(inventory, /if v_movement_id is not null then[\s\S]*quantity_on_hand = quantity_on_hand - i\.issue_quantity/);
assert.match(inventory, /where id = p_issue_id and status = 'draft'/);

console.log("Store concurrency/idempotency rules: PASS (static contract; no runtime concurrency simulation)");
