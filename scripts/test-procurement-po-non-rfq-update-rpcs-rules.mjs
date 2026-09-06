import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609060004_procurement_purchase_orders_non_rfq_update_rpcs.sql",
  "utf8",
);

assert.equal((migration.match(/create or replace function public\./g) || []).length, 4);
assert.match(migration, /update_procurement_purchase_order_draft_atomic/);
assert.match(migration, /update_procurement_purchase_order_draft_with_additional_charges/);
assert.match(migration, /update_procurement_po_draft_with_additional_charges_atomic/);
assert.match(migration, /set_procurement_purchase_order_freight_atomic/);
assert.doesNotMatch(migration, /procurement_rfqs|procurement_rfq_|rfq_id|rfq_vendor_id/);
assert.match(migration, /resolve_procurement_po_master_snapshot/);
assert.match(migration, /status in \('draft', 'sent_back'\)/);
assert.match(migration, /source_type not in \('direct', 'indent'\)/);
assert.match(migration, /coalesce\(total_freight_amount, 0\)\s*\+\s*v_total/);
assert.match(migration, /v_freight\s*\+\s*coalesce\(v_po\.total_additional_charges_amount, 0\)/);
assert.match(migration, /return public\.update_procurement_purchase_order_draft_with_additional_charges\(/);
assert.doesNotMatch(migration, /return public\.update_procurement_po_draft_with_additional_charges_atomic\(/);

function total({ basic, gst, freight = 0, additional = 0 }) {
  return basic + gst + freight + additional;
}

const base = { basic: 100, gst: 18 };
assert.equal(total({ ...base, freight: 10, additional: 5 }), 133);
assert.equal(total({ ...base, additional: 5, freight: 10 }), 133);
assert.equal(total({ ...base, freight: 10 }), 128);
assert.equal(total({ ...base, additional: 5 }), 123);
assert.equal(total(base), 118);

console.log("Part 4 Purchase Order update RPC rules passed");
