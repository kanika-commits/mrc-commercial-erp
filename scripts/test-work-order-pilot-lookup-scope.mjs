import assert from "node:assert/strict";
import fs from "node:fs";

const lookup = fs.readFileSync("app/api/work-orders/create-lookups/route.ts", "utf8");
const poLookup = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");

assert.match(lookup, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(lookup, /hasGlobalProcurementAccess\(auth\)/);
assert.match(lookup, /companies = companies\.in\("id", auth\.companies\)/);
assert.match(lookup, /sites = sites\.in\("id", auth\.sites\)/);
assert.doesNotMatch(lookup, /sites = sites\.in\("company_id", auth\.companies\)/);
assert.doesNotMatch(lookup, /site\.company_id === company\.id/);
assert.match(lookup, /const vendors: any = scoped\(admin\.from\("vendors"\)/);
assert.match(lookup, /return NextResponse\.json\(\{[\s\S]*companies: companyResult\?\.data \|\| \[\],[\s\S]*sites: siteResult\?\.data \|\| \[\],[\s\S]*vendors: resolvedVendors/);
assert.match(poLookup, /requireProcurementPermission\(request, MODULE, "add"\)/);

console.log("Work Order Pilot lookup scope contract passed.");
