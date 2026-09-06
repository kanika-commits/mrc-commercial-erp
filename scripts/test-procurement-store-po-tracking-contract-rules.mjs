import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/goods-receipts/purchase-orders/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/store/goods-receipts/purchase-orders/[id]/page.tsx", "utf8");
const createRoute = fs.readFileSync("app/api/procurement/goods-receipts/route.ts", "utf8");
const schema = fs.readFileSync("supabase/migrations/202609070001_store_grn_schema_baseline.sql", "utf8");
assert.match(route, /procurement_purchase_orders/);
assert.match(route, /\["approved", "issued"\]/);
assert.match(route, /items:procurement_purchase_order_items/);
assert.match(route, /procurement_goods_receipts/);
assert.match(route, /procurement_goods_receipt_items/);
assert.match(route, /received_quantity,accepted_quantity,rejected_quantity,hold_quantity/);
assert.match(page, /Continue Receipt/);
assert.match(page, /Received/);
assert.match(page, /Accepted/);
assert.match(createRoute, /procurement_purchase_orders/);
assert.match(createRoute, /existingDraft/);
assert.match(schema, /purchase_order_id uuid not null references public\.procurement_purchase_orders/);
assert.doesNotMatch(`${route}\n${page}\n${createRoute}`, /procurement_rfqs|final_selection|VendorCreateForm|vendors\/complete-missing/i);

console.log("Store PO tracking contract rules: PASS");
