import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609070004_store_security_baseline.sql", "utf8");
const tables = [
  "procurement_goods_receipts", "procurement_goods_receipt_items", "procurement_goods_receipt_events",
  "procurement_goods_receipt_documents", "procurement_goods_receipt_verified_values",
  "procurement_inventory_balances", "procurement_inventory_movements",
  "procurement_material_issues", "procurement_material_issue_items", "procurement_material_issue_events",
];
for (const table of tables) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`public\\.${table}`));
}
assert.match(migration, /from public, anon, authenticated/);
assert.match(migration, /to service_role/);
assert.equal((migration.match(/grant execute on function public\./g) || []).length, 4);
assert.match(migration, /revoke all on function public\.post_procurement_inventory_receipt/);
assert.match(migration, /procurement_goods_receipts/);
assert.match(migration, /procurement_inventory/);
for (const action of ["view", "add", "edit", "approve", "export"]) assert.match(migration, new RegExp(`'${action}'`));
assert.match(migration, /insert into storage\.buckets\(id, name, public\)/);
assert.match(migration, /'procurement-rfq-quotation-documents', 'procurement-rfq-quotation-documents', false/);
assert.match(migration, /on conflict \(id\) do update set public = false/);
assert.doesNotMatch(migration, /create policy|storage\.objects|procurement_rfqs|final_selection|VendorCreateForm|vendors\/complete-missing/i);

console.log("Store security/storage contract rules: PASS");
