import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609070002_store_grn_workflow_baseline.sql",
  "utf8",
);

assert.match(migration, /create or replace function public\.next_procurement_goods_receipt_number\(p_organization_id uuid, p_grn_date date\)\s*\nreturns text/);
assert.match(migration, /create or replace function public\.finalize_procurement_goods_receipt_atomic\(p_grn_id uuid, p_actor jsonb\)\s*\nreturns jsonb/);
assert.match(migration, /security definer[\s\S]*set search_path = public, pg_temp/);
assert.match(migration, /from public\.procurement_goods_receipts[\s\S]*where id = p_grn_id[\s\S]*for update/);
assert.match(migration, /from public\.procurement_purchase_orders[\s\S]*where id = v_grn\.purchase_order_id[\s\S]*for update/);
assert.match(migration, /v_po\.status not in \('approved', 'issued'\)/);
assert.match(migration, /v_has_invoice[\s\S]*v_has_challan[\s\S]*if not v_has_invoice and not v_has_challan/);
assert.match(migration, /rejected_quantity > 0 and nullif\(btrim\(v_item\.rejection_reason\), ''\) is null/);
assert.match(migration, /document_type = 'weighbridge_slip'/);
assert.match(migration, /field_name = 'gross_weight'/);
assert.match(migration, /field_name = 'tare_weight'/);
assert.match(migration, /v_gross <= v_tare/);
assert.match(migration, /gh\.status = 'finalized'/);
assert.match(migration, /v_accepted \+ v_item\.accepted_quantity > v_item\.ordered_quantity/);
assert.match(migration, /event_type, actor_id, actor_name, actor_email, metadata\)[\s\S]*'finalized'/);

assert.match(migration, /create trigger trg_lock_finalized_goods_receipts[\s\S]*before update or delete/);
assert.match(migration, /create trigger trg_lock_finalized_goods_receipt_items[\s\S]*before insert or update or delete/);
assert.match(migration, /create trigger trg_lock_finalized_goods_receipt_documents[\s\S]*before insert or update or delete/);
assert.match(migration, /create trigger trg_lock_finalized_goods_receipt_values[\s\S]*before insert or update or delete/);
assert.match(migration, /if old\.status = 'finalized'[\s\S]*Finalized Goods Receipt Notes are immutable/);
assert.match(migration, /Evidence and verified values on finalized Goods Receipt Notes are immutable/);
assert.match(migration, /if tg_op = 'DELETE'[\s\S]*return old;[\s\S]*return new;/);

assert.match(migration, /create or replace function public\.recalculate_goods_receipt_weight_reconciliation/);
assert.match(migration, /create or replace function public\.refresh_goods_receipt_weight_reconciliation_from_verified_value/);
assert.match(migration, /create or replace function public\.reconcile_goods_receipt_item_weight/);
assert.match(migration, /source_type, final_value, verified_by\)[\s\S]*'net_weight', 'system_calculated'/);

assert.doesNotMatch(migration, /procurement_rfqs|procurement_rfq_|rfq_id|rfq_vendor_id|final_selection|final_selection_id|negotiation|procurement_inventory_|procurement_material_issue|VendorCreateForm|vendors\/complete-missing/i);
assert.doesNotMatch(migration, /create table|create sequence.*inventory|inventory posting/i);

console.log("Store GRN workflow baseline rules: PASS");
