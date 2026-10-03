import assert from "node:assert/strict";
import fs from "node:fs";

const preview = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");

assert.match(preview, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(preview, /loadActorOrganizationScope/);
assert.match(preview, /resolveWriteOrganizationId\(/);
assert.match(preview, /isInOrganizationScope\(scope, company\.organization_id\)/);
assert.match(preview, /company\.organization_id !== site\.organization_id/);
assert.match(preview, /company\.organization_id !== vendor\.organization_id/);
assert.match(preview, /site\.company_id && site\.company_id !== company\.id/);
assert.match(preview, /Selected company, site, or vendor is outside the authorized organization scope/);
assert.match(preview, /itemMap\.get\(text\(item\.item_master_id/);
assert.match(preview, /authorized\.letterheadSnapshot/);
assert.match(preview, /authorized\.terms/);
assert.doesNotMatch(preview, /createWorkOrderDriveFolder|uploadDriveFile/);
assert.doesNotMatch(preview, /\.from\("work_orders"\)\.(insert|update|upsert|delete)/);
assert.doesNotMatch(preview, /body\.company_name/);
assert.doesNotMatch(preview, /body\.site_name/);
assert.doesNotMatch(preview, /body\.vendor_snapshot/);
assert.doesNotMatch(preview, /body\.item_snapshots/);

console.log("Work Order Pilot preview scope contract passed.");
