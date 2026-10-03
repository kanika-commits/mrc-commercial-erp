import assert from "node:assert/strict";
import fs from "node:fs";

const suggestNumber = fs.readFileSync("app/api/work-orders/suggest-number/route.ts", "utf8");

assert.match(suggestNumber, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(suggestNumber, /loadActorOrganizationScope/);
assert.match(suggestNumber, /resolveWriteOrganizationId\(scope\)/);
assert.match(suggestNumber, /isInOrganizationScope\(scope, company\.organization_id\)/);
assert.match(suggestNumber, /company\.organization_id !== activeOrganizationId/);
assert.match(suggestNumber, /hasGlobalProcurementAccess\(auth\)/);
assert.match(suggestNumber, /access\.companies\.includes\(companyId\)/);
assert.match(suggestNumber, /access\.sites\.includes\(siteId\)/);
assert.doesNotMatch(suggestNumber, /site\.company_id !== null && site\.company_id !== company\.id/);
assert.match(suggestNumber, /from\("work_orders"\)\.select\("wo_number"\)/);
assert.match(suggestNumber, /\.eq\("company_id", company\.id\)\.eq\("site_id", site\.id\)/);
assert.match(suggestNumber, /Could not read existing Work Order numbers/);
assert.match(suggestNumber, /return NextResponse\.json\(\{ wo_number:/);

function next(prefix, numbers) {
  const valid = numbers
    .map((value) => Number(String(value).split("/").pop()))
    .filter((value) => Number.isInteger(value) && value >= 1)
  return `${prefix}${valid.length ? Math.max(...valid) + 1 : 101}`;
}

assert.equal(next("IIITSONIPAT/MRC-TECH/", ["IIITSONIPAT/MRC-TECH/23"]), "IIITSONIPAT/MRC-TECH/24");
assert.equal(next("JAT/MRC/", ["JAT/MRC/284"]), "JAT/MRC/285");
assert.equal(next("IIITSONIPAT/MRC-TECH/", ["IIITSONIPAT/MRC-TECH/006-A", "IIITSONIPAT/MRC-TECH/23"]), "IIITSONIPAT/MRC-TECH/24");

console.log("Work Order Pilot number scope contract passed.");
