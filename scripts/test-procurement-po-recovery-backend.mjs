import assert from "node:assert/strict";
import fs from "node:fs";

const poRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const debitRoute = fs.readFileSync("app/api/debit-notes/route.ts", "utf8");
const helper = fs.readFileSync("lib/procurement/contractorRecoveryDebitNote.server.ts", "utf8");
const core = fs.readFileSync("lib/procurement/contractorRecoveryCore.ts", "utf8");

assert.match(helper, /ensureRecoveryDraft/);
assert.match(core, /source_purchase_order_id/);
assert.match(core, /code !== "23505"/);
assert.match(core, /source_purchase_order_documents/);
assert.match(core, /total_basic_amount/);
assert.match(core, /total_gst_amount/);
assert.match(core, /total_amount/);
assert.match(core, /status: "Draft"/);
assert.match(core, /approval_status: "Pending"/);
assert.match(createRoute, /validatePurchaseOrderPurpose/);
assert.match(createRoute, /validateRecoveryWorkOrder/);
assert.match(poRoute, /recoveryFields/);
assert.match(poRoute, /action === "submit" \|\| action === "approve"/);
assert.match(poRoute, /ensureContractorRecoveryDebitNote/);
assert.match(debitRoute, /source_purchase_order_id/);
assert.match(debitRoute, /cannot be approved until the linked Purchase Order is approved/);
console.log("procurement PO recovery backend contract checks passed");
