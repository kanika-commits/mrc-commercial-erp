import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");

assert.match(route, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(route, /loadActorOrganizationScope/);
assert.match(route, /resolveWriteOrganizationId\(scope\)/);
assert.match(route, /isInOrganizationScope\(scope, company\.organization_id\)/);
assert.match(route, /company\.organization_id !== site\.organization_id/);
assert.match(route, /company\.organization_id !== vendor\.organization_id/);
assert.match(route, /site\.company_id && site\.company_id !== company\.id/);
assert.match(route, /creation_request_id/);
assert.match(route, /approval_status: "draft"/);
assert.match(route, /work_order_vendors/);
assert.match(route, /work_order_items/);
assert.match(route, /validateWorkOrderSupportingFiles/);
assert.doesNotMatch(route, /google|drive/i);

console.log("Work Order Pilot create route contract passed.");
