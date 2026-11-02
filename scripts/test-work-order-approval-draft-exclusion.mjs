import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/approvals/work-orders/route.ts", "utf8");

assert.match(route, /approval_status\.is\.null,approval_status\.ilike\.pending/);
assert.doesNotMatch(route, /approval_status\.ilike\.draft/);
assert.match(route, /case-insensitive submitted\/pending rows/);
assert.match(route, /applyOrganizationScope/);
assert.match(route, /applyCompanySiteScope/);

console.log("Work Order approval queue excludes drafts and preserves pending scope: PASS");
