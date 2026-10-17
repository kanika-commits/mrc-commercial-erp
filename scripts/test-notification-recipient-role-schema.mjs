import assert from "node:assert/strict";
import fs from "node:fs";

const resolver = fs.readFileSync("lib/serverNotificationRecipients.ts", "utf8");
assert.match(resolver, /from\("user_roles"\)\.select\("user_id,role_id"\)/);
assert.doesNotMatch(resolver, /from\("user_roles"\)[\s\S]{0,120}organization_id/);
assert.match(resolver, /user_access_assignments/);
assert.match(resolver, /eq\("organization_id", options\.organizationId\)/);
assert.match(resolver, /row\.company_id === options\.companyId/);
assert.match(resolver, /row\.site_id === options\.siteId/);

console.log("notification recipient role-schema regression passed");
