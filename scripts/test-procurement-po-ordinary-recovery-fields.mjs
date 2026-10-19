import assert from "node:assert/strict";
import fs from "node:fs";

const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const editRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const form = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(createRoute, /recoveryCommercial = recovery\.purpose === "Recover from contractor"/);
assert.match(createRoute, /: \{\}/);
assert.match(createRoute, /update\(recovery\.purpose === "Recover from contractor"/);
assert.match(editRoute, /update\(recovery\.purpose === "Recover from contractor"/);
assert.match(form, /commercial\.purpose === "Recover from contractor" &&/);
assert.match(form, /Recover from contractor/);
console.log("Ordinary PO recovery-field isolation contract: PASS");
