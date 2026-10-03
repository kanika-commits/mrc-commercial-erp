import assert from "node:assert/strict";
import fs from "node:fs";

const suggestNumber = fs.readFileSync("app/api/work-orders/suggest-number/route.ts", "utf8");

assert.match(suggestNumber, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(suggestNumber, /loadActorOrganizationScope/);
assert.match(suggestNumber, /resolveWriteOrganizationIdForRequest/);
assert.match(suggestNumber, /isInOrganizationScope\(scope, company\.organization_id\)/);
assert.match(suggestNumber, /company\.organization_id !== activeOrganizationId/);
assert.match(suggestNumber, /site\.company_id !== null && site\.company_id !== company\.id/);
assert.match(suggestNumber, /from\("work_orders"\)\.select\("wo_number"\)/);
assert.match(suggestNumber, /return NextResponse\.json\(\{ wo_number:/);

console.log("Work Order Pilot number scope contract passed.");
