import assert from "node:assert/strict";
import fs from "node:fs";

const effective = fs.readFileSync("lib/procurement/poRevisionEffective.ts", "utf8");
const runtime = fs.readFileSync("lib/procurement/poRevisionRuntime.ts", "utf8");
const route = fs.readFileSync("app/api/procurement/goods-receipts/route.ts", "utf8");

assert.match(effective, /latestEffectiveByFamily/);
assert.match(effective, /effectiveRevisionIds/);
assert.match(runtime, /loadFamilyReceiptTotals/);
assert.match(runtime, /remainingQuantity/);
assert.match(route, /poRevisionEffective/);
assert.match(route, /poRevisionRuntime/);

console.log("PO revision runtime module presence and receipt-route imports: PASS");
