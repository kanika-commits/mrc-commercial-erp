import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/drafts/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(route, /const draftOrganizationId = result\.data\.organization_id/);
assert.match(route, /resolveWriteOrganizationId\(result\.scope, draftOrganizationId\)/);
assert.match(route, /company\?\.organization_id === draftOrganizationId/);
assert.match(route, /site\?\.organization_id === draftOrganizationId/);
assert.match(route, /vendor\?\.organization_id === draftOrganizationId/);
assert.match(route, /siteBelongsToCompany/);
assert.match(route, /isInOrganizationScope\(result\.scope, draftOrganizationId\)/);
assert.match(page, /draftLoading \|\| lookupLoading \|\| !draftLookupRef\.current/);
assert.match(page, /disabled=\{saving \|\| draftLoading \|\| lookupLoading/);

console.log("Saved Work Order preview hydration and organization-scope contract: PASS");
