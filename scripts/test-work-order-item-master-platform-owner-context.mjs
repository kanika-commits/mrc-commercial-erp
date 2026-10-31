import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");

assert.match(route, /resolveWriteOrganizationId/);
assert.match(route, /scope === null/);
assert.match(route, /const organizationId = resolveWriteOrganizationId\(scope\)/);
assert.match(route, /organizationId \? query\.eq\("organization_id", organizationId\) : query\.limit\(0\)/);
assert.match(route, /targetOrganizationId/);
assert.doesNotMatch(route, /organization_id:\s*body\.organization_id/);
console.log("Work Order Item Master Platform Owner organization-context regression passed.");
