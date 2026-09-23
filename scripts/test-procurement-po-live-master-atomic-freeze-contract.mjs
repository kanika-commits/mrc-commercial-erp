import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const projection = fs.readFileSync("lib/procurement/poDraftMasterView.server.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609230004_procurement_po_live_master_atomic_freeze.sql", "utf8");

assert.match(route, /resolveDraftPoMasterView\(result\.admin, result\.row\)/);
assert.match(route, /p_freeze_projection: freezePayload/);
assert.doesNotMatch(route, /\.from\("procurement_purchase_orders"\)\.update\(/);
assert.match(projection, /\["draft", "sent_back"\]/);
assert.match(projection, /procurement_purchase_order_items/);
assert.match(projection, /company_gst_registrations/);
assert.match(projection, /gst_billing: gstRegistration\.data/);
assert.match(projection, /item_name_snapshot: current\.item_name/);
assert.match(projection, /uom_snapshot: current\.default_uom\?\.uom_code/);
assert.match(projection, /item_id \? itemById\.get/);
assert.match(migration, /p_freeze_projection jsonb default null::jsonb/);
assert.match(migration, /add column if not exists item_id uuid/);
assert.match(migration, /foreign key \(item_id\) references public\.procurement_items\(id\)/);
assert.match(migration, /candidate_count = 1/);
assert.match(migration, /populate_procurement_purchase_order_item_master_id/);
assert.match(migration, /if nullif\(btrim\(new\.item_code_snapshot\), ''\) is null then return new/);
assert.match(migration, /i\.item_name = new\.item_name_snapshot/);
assert.match(migration, /for update/);
assert.match(migration, /revision_no <> 0 or v_po\.previous_revision_id is not null/);
assert.match(migration, /vendor_snapshot = p_freeze_projection->'vendor_snapshot'/);
assert.match(migration, /delivery_snapshot = p_freeze_projection->'delivery_snapshot'/);
assert.match(migration, /item_code_snapshot/);
assert.match(migration, /item_name_snapshot/);
assert.match(migration, /uom_snapshot/);
assert.match(migration, /return public\.transition_procurement_purchase_order_atomic\(/);
assert.doesNotMatch(migration, /standard_terms_snapshot\s*=/);
assert.doesNotMatch(migration, /total_amount\s*=/);
assert.doesNotMatch(migration, /sites\.company_id/);

console.log("PASS: original R-0 live-master atomic freeze contract");
