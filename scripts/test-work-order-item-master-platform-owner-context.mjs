import assert from "node:assert/strict";
import fs from "node:fs";

const scope = fs.readFileSync("lib/serverOrganizationScope.ts", "utf8");
const route = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const suggest = fs.readFileSync("app/api/work-orders/suggest-number/route.ts", "utf8");

assert.match(scope, /resolveWriteOrganizationId/);
assert.match(scope, /scope === null/);
assert.match(route, /resolveWriteOrganizationId\(scope\)/);
assert.match(route, /targetOrganizationId/);
assert.doesNotMatch(route, /organization_id:\s*body\.organization_id/);
assert.match(suggest, /resolveWriteOrganizationId\(scope,/);
assert.match(suggest, /company\.organization_id !== activeOrganizationId/);
assert.match(suggest, /company\.organization_id !== site\.organization_id/);

console.log("Work Order Item Master Platform Owner organization-context regression passed.");
