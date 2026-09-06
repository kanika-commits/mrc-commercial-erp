import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609070001_store_grn_schema_baseline.sql",
  "utf8",
);

for (const table of [
  "procurement_goods_receipts",
  "procurement_goods_receipt_items",
  "procurement_goods_receipt_events",
  "procurement_goods_receipt_documents",
  "procurement_goods_receipt_verified_values",
]) {
  assert.match(
    migration,
    new RegExp(`create table if not exists public\\.${table}\\s*\\(`),
    `missing table ${table}`,
  );
}

assert.match(migration, /create sequence if not exists public\.procurement_goods_receipt_number_seq/);
assert.match(migration, /purchase_order_id uuid not null references public\.procurement_purchase_orders\(id\)/);
assert.match(migration, /purchase_order_item_id uuid not null references public\.procurement_purchase_order_items\(id\)/);
assert.match(migration, /status text not null default 'draft' check \(status in \('draft', 'finalized'\)\)/);
assert.match(migration, /procurement_goods_receipt_items_equation check \(received_quantity = accepted_quantity \+ rejected_quantity \+ hold_quantity\)/);
assert.match(migration, /procurement_goods_receipt_items_rejection_reason check/);
assert.match(migration, /freight_amount numeric\(14,2\)/);
assert.match(migration, /freight_amount is null or freight_amount >= 0/);

for (const field of [
  "normalized_received_kg",
  "weighbridge_net_kg",
  "weight_difference_kg",
  "weight_reconciliation_status",
  "weight_reconciliation_remarks",
]) {
  assert.match(migration, new RegExp(`\\b${field}\\b`), `missing weight field ${field}`);
}

assert.match(migration, /procurement_goods_receipt_documents_storage_uidx unique \(storage_bucket, storage_key\)/);
assert.match(migration, /create table if not exists public\.procurement_goods_receipt_verified_values/);

assert.doesNotMatch(migration, /rfq|final_selection|negotiation|procurement_inventory_|procurement_material_issue/i);
assert.doesNotMatch(migration, /create or replace function|create trigger|enable row level|grant |revoke |erp_modules|role_permissions/i);

console.log("Store GRN schema baseline rules: PASS");
