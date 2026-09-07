import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const lookups = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const access = fs.readFileSync("lib/serverProcurementAccess.ts", "utf8");

assert.match(page, /const sites = useMemo\(\(\) => lookups\.sites/);
assert.doesNotMatch(page, /site\.company_id\s*===\s*companyId/);
assert.doesNotMatch(page, /!site\.company_id\s*\|\|\s*site\.company_id/);
assert.match(lookups, /from\("sites"\)\.select\("id,organization_id,company_id,site_name,site_code,location,state,status"\)\.eq\("status", "active"\)/);
assert.match(lookups, /sites = sites\.in\("id", auth\.sites\)/);
assert.doesNotMatch(lookups, /sites = sites\.in\("company_id", auth\.companies\)/);
assert.match(lookups, /applyOrganizationAccess\(admin\.from\("sites"\)/);
assert.match(lookups, /companyResult\.data \|\| \[\], sites: siteResult\.data \|\| \[\]/);
assert.match(access, /export async function validateOrganizationSiteAccess/);
assert.match(createRoute, /validateOrganizationSiteAccess\(admin, auth, selectedCompanyId, selectedSiteId\)/);

console.log("Purchase Order company-neutral site scope rules passed.");
