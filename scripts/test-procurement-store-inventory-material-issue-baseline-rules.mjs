import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609070003_store_inventory_material_issue_baseline.sql",
  "utf8",
);

for (const table of [
  "procurement_inventory_balances",
  "procurement_inventory_movements",
  "procurement_material_issues",
  "procurement_material_issue_items",
  "procurement_material_issue_events",
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`));
}

assert.match(migration, /procurement_inventory_balances_identity_uidx unique \(organization_id, company_id, site_id, stock_identity_key\)/);
assert.match(migration, /quantity_on_hand numeric\(14,3\)/);
assert.match(migration, /total_received numeric\(14,3\)/);
assert.match(migration, /total_issued numeric\(14,3\)/);
assert.match(migration, /movement_type text not null check \(movement_type in \('receipt_accepted', 'material_issue'\)\)/);
assert.match(migration, /procurement_inventory_movements_source_uidx unique \(source_type, source_item_id, movement_type\)/);
assert.match(migration, /create trigger trg_prevent_procurement_inventory_movement_mutation[\s\S]*before update or delete/);

assert.match(migration, /create or replace function public\.procurement_inventory_identity_key\(p_material_item_id uuid, p_po_item_id uuid, p_uom text, p_make text, p_specification text\)/);
assert.match(migration, /case when p_material_item_id is not null then 'master:' \|\| p_material_item_id::text else 'po_item:' \|\| p_po_item_id::text end/);
assert.match(migration, /md5\(coalesce\(lower\(btrim\(p_uom\)\)/);

assert.match(migration, /create or replace function public\.post_procurement_inventory_receipt\(p_grn_id uuid, p_actor jsonb\)/);
assert.match(migration, /after update of status on public\.procurement_goods_receipts/);
assert.match(migration, /old\.status is distinct from new\.status and new\.status = 'finalized'/);
assert.match(migration, /i\.accepted_quantity > 0/);
assert.match(migration, /on conflict \(organization_id, company_id, site_id, stock_identity_key\) do nothing/);
assert.match(migration, /from public\.procurement_inventory_balances[\s\S]*stock_identity_key = public\.procurement_inventory_identity_key[\s\S]*for update/);
assert.match(migration, /movement_type, quantity_in/);
assert.match(migration, /'receipt_accepted', r\.accepted_quantity/);
assert.match(migration, /if v_movement_id is not null then[\s\S]*quantity_on_hand = quantity_on_hand \+ r\.accepted_quantity/);

assert.match(migration, /create or replace function public\.next_procurement_material_issue_number\(p_organization_id uuid, p_issue_date date\)[\s\S]*returns text/);
assert.match(migration, /return 'MI\/' \|\| to_char\(p_issue_date, 'YYYY'\)/);
assert.match(migration, /create or replace function public\.finalize_procurement_material_issue_atomic\(p_issue_id uuid, p_actor jsonb\)[\s\S]*returns jsonb/);
assert.match(migration, /from public\.procurement_material_issues where id = p_issue_id for update/);
assert.match(migration, /h\.status <> 'draft'/);
assert.match(migration, /order by b\.id, ii\.id[\s\S]*for update of b/);
assert.match(migration, /balance_organization_id <> h\.organization_id/);
assert.match(migration, /i\.issue_quantity <= 0/);
assert.match(migration, /i\.quantity_on_hand < i\.issue_quantity/);
assert.match(migration, /'material_issue', i\.issue_quantity/);
assert.match(migration, /on conflict \(source_type, source_item_id, movement_type\) do nothing returning id into v_movement_id/);
assert.match(migration, /quantity_on_hand = quantity_on_hand - i\.issue_quantity[\s\S]*total_issued = total_issued \+ i\.issue_quantity/);
assert.match(migration, /where id = p_issue_id and status = 'draft'/);
assert.match(migration, /procurement_material_issue_events\(material_issue_id, event_type/);

assert.match(migration, /create trigger trg_lock_finalized_material_issues[\s\S]*before update or delete/);
assert.match(migration, /create trigger trg_lock_finalized_material_issue_items[\s\S]*before insert or update or delete/);
assert.match(migration, /Finalized Material Issues are immutable/);
assert.match(migration, /if tg_op = 'DELETE' then return old; end if;[\s\S]*return new/);
assert.doesNotMatch(migration, /create table if not exists public\.procurement_goods_receipts|create table if not exists public\.procurement_goods_receipt_items/);
assert.doesNotMatch(migration, /procurement_rfqs|procurement_rfq_|rfq_id|rfq_vendor_id|final_selection|final_selection_id|negotiation|VendorCreateForm|vendors\/complete-missing/i);
assert.doesNotMatch(migration, /enable row level|grant |revoke |erp_modules|role_permissions/i);

console.log("Store inventory/material issue baseline rules: PASS (static contract; no runtime concurrency simulation)");
