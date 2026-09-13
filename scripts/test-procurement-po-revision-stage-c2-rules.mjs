import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync("lib/procurement/poRevisionEffective.ts", "utf8");
const queue = fs.readFileSync("app/api/procurement/purchase-queue/route.ts", "utf8");
const grn = fs.readFileSync("app/api/procurement/goods-receipts/route.ts", "utf8");
const lookup = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");
for (const text of [helper, queue, grn]) assert.match(text, /latestEffectiveByFamily|effectiveRevisionIds|effectiveIds/);
assert.match(helper, /revision_family_id/);
assert.match(helper, /approved.*issued/);
assert.match(helper, /superseded_by_revision_id/);
assert.match(queue, /effectiveIds\.has/);
assert.match(grn, /latest effective Purchase Order revision/);
assert.doesNotMatch(lookup, /effectiveRevisionIds|latestEffectiveByFamily/);
assert.match(helper, /\[\"approved\", \"issued\"\]\.includes/);
assert.match(helper, /!row\.superseded_by_revision_id/);
assert.match(helper, /family \? row\.revision_family_id === family : row\.id === source\.id/);
assert.match(grn + queue + lookup, /source_requisition_line_key/);
console.log("PO revision Stage C2 rules: PASS");
