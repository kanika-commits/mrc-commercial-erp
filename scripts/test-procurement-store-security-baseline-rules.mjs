import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609070004_store_security_baseline.sql",
  "utf8",
);

const storeTables = [
  "procurement_goods_receipts",
  "procurement_goods_receipt_items",
  "procurement_goods_receipt_events",
  "procurement_goods_receipt_documents",
  "procurement_goods_receipt_verified_values",
  "procurement_inventory_balances",
  "procurement_inventory_movements",
  "procurement_material_issues",
  "procurement_material_issue_items",
  "procurement_material_issue_events",
];

for (const table of storeTables) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`public\\.${table}`));
}

const tableGrantBlock = migration.match(/revoke all on table([\s\S]*?)from public, anon, authenticated;/)?.[1] || "";
const serviceRoleBlock = migration.match(/grant all on table([\s\S]*?)to service_role;/)?.[1] || "";
for (const table of storeTables) {
  assert.match(tableGrantBlock, new RegExp(`public\\.${table}`), `missing revoke for ${table}`);
  assert.match(serviceRoleBlock, new RegExp(`public\\.${table}`), `missing service_role grant for ${table}`);
}

const intendedRpcGrants = [
  "next_procurement_goods_receipt_number(uuid, date)",
  "finalize_procurement_goods_receipt_atomic(uuid, jsonb)",
  "next_procurement_material_issue_number(uuid, date)",
  "finalize_procurement_material_issue_atomic(uuid, jsonb)",
];
const grantLines = migration.match(/grant execute on function public\.[^;]+to service_role;/g) || [];
assert.equal(grantLines.length, intendedRpcGrants.length);
for (const signature of intendedRpcGrants) {
  assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()[\].,]/g, "\\$&")} to service_role`));
}
assert.match(migration, /revoke all on function public\.recalculate_goods_receipt_weight_reconciliation\(uuid\)/);
assert.match(migration, /revoke all on function public\.post_procurement_inventory_receipt\(uuid, jsonb\)/);
assert.match(migration, /revoke all on function public\.prevent_finalized_procurement_material_issue_mutation\(\)/);

assert.doesNotMatch(migration, /create or replace function/);

for (const moduleCode of ["procurement_goods_receipts", "procurement_inventory"]) {
  assert.match(migration, new RegExp(`'${moduleCode}'`));
}
for (const action of ["view", "add", "edit", "approve", "export"]) {
  assert.match(migration, new RegExp(`'${action}'`));
}
assert.match(migration, /cross join \(values \('procurement_goods_receipts'\), \('procurement_inventory'\)\)/);

assert.match(migration, /insert into storage\.buckets\(id, name, public\)/);
assert.match(migration, /'procurement-rfq-quotation-documents', 'procurement-rfq-quotation-documents', false/);
assert.match(migration, /on conflict \(id\) do update set public = false/);
assert.doesNotMatch(migration, /create policy|storage\.objects/);
assert.doesNotMatch(migration, /procurement_rfqs|procurement_rfq_|rfq_id|rfq_vendor_id|final_selection|final_selection_id|VendorCreateForm|vendors\/complete-missing/i);

console.log("Store security baseline rules: PASS");
