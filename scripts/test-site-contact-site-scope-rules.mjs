import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/site-contacts/route.ts", "utf8");

assert.match(route, /function siteIsAuthorized\(access: any, site: any\)/);
assert.match(route, /access\.sites.*includes\(site\.id\)/);
assert.match(route, /return !site\.company_id \|\|/);
assert.match(route, /siteIsAuthorized\(access, site\)/);
assert.doesNotMatch(route, /access\.companies.*includes\(site\.company_id\)\)\);/);
assert.match(route, /site\.status !== "active"/);
assert.match(route, /save_site_contact_atomic/);

console.log("Site Contact site-scope rules: PASS");
