import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");

assert.match(route, /update_procurement_po_draft_with_additional_charges_atomic/);
assert.match(route, /set_procurement_purchase_order_freight_atomic/);
assert.match(route, /hasOwnProperty\.call\(commercial, "additional_charges"\)/);
assert.match(route, /hasOwnProperty\.call\(commercial, "freight_amount"\)/);
assert.match(page, /additional_charges: additionalCharges\.map/);
assert.match(page, /freight_amount/);

function total({ basic, gst, freight = 0, additional = 0 }) {
  return basic + gst + freight + additional;
}

const base = { basic: 100, gst: 18 };
assert.equal(total({ ...base, freight: 10, additional: 5 }), 133);
assert.equal(total({ ...base, freight: 10, additional: 5 }), total({ ...base, additional: 5, freight: 10 }));
assert.equal(total({ ...base, freight: 10 }), 128);
assert.equal(total({ ...base, additional: 5 }), 123);
assert.equal(total(base), 118);

console.log("PO total invariant rules passed");
