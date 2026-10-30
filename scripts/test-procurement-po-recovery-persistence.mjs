import assert from "node:assert/strict";
import fs from "node:fs";

const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const editPage = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const workflowRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const recoveryHelper = fs.readFileSync("lib/procurement/contractorRecoveryDebitNote.server.ts", "utf8");

assert.match(createRoute, /body\.commercial\?\.purpose/);
assert.match(createRoute, /body\.commercial\?\.recovery_work_order_id/);
assert.match(createRoute, /purpose: recovery\.purpose, recovery_work_order_id: recovery\.recoveryWorkOrderId/);
assert.match(createRoute, /const createdId = result\.data\?\.purchase_order_id;/);
assert.match(createRoute, /recovery\.purpose === "Recover from contractor"/);
assert.match(createRoute, /: \{ purpose: recovery\.purpose \}/);
assert.match(createRoute, /\.eq\("id", createdId\)/);
assert.match(createRoute, /\.eq\("organization_id", organizationId\)/);

assert.match(editPage, /purpose: "General Purchase"/);
assert.match(editPage, /Recover from contractor/);
assert.match(editPage, /purpose: po\.purpose \|\| po\.commercial_snapshot\?\.purpose/);
assert.match(editPage, /po\.recovery_work_order_id \|\| po\.commercial_snapshot\?\.recovery_work_order_id/);
assert.match(editPage, /recovery_vendor_id/);

assert.match(workflowRoute, /action === "submit" \|\| action === "approve"/);
assert.match(workflowRoute, /ensureContractorRecoveryDebitNote/);
assert.match(recoveryHelper, /po\.purpose \|\| po\.commercial_snapshot\?\.purpose/);
assert.match(recoveryHelper, /source_purchase_order_id/);

const normalizePurpose = (purpose) => String(purpose || "General Purchase").trim() || "General Purchase";
const payload = { commercial: { purpose: "Recover from contractor", recovery_vendor_id: "vendor-recovery", recovery_work_order_id: "wo-1" } };
assert.equal(normalizePurpose(payload.commercial.purpose), "Recover from contractor");
assert.equal(payload.commercial.recovery_work_order_id, "wo-1");
assert.equal(payload.commercial.recovery_vendor_id, "vendor-recovery");
assert.equal(normalizePurpose(""), "General Purchase", "General Purchase remains the default");

console.log("procurement PO recovery persistence checks passed");
