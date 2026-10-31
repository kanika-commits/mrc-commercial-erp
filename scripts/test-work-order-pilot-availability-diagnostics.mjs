import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/pilot/availability/route.ts", "utf8");

for (const stage of [
  "authorization",
  "request_validation",
  "control_plane_client",
  "organization_scope",
  "vendor_query",
  "company_site_query",
  "work_order_query",
]) assert.match(route, new RegExp(`stage = "${stage}"`));

assert.match(route, /console\.error\("work_order_pilot_availability_failed", \{ stage \}\)/);
assert.doesNotMatch(route, /console\.error\([^\n]*(error|request|params|vendorId|companyId|siteId)/i);
assert.match(route, /error: "Availability could not be verified\."/);
assert.match(route, /return NextResponse\.json\(\{ available: false, error: "Availability could not be verified\." \}, \{ status: 500 \}\)/);
assert.match(route, /applyOrganizationScope\(admin\.from\("vendors"/);
assert.match(route, /applyOrganizationScope\(admin\.from\("companies"/);
assert.match(route, /applyOrganizationScope\(admin\.from\("sites"/);
assert.match(route, /\.eq\("pilot_vendor_id", vendorId\)/);
assert.match(route, /\.not\("creation_request_id", "is", null\)/);

console.log("Work Order Pilot availability diagnostics and fail-closed contract passed.");
