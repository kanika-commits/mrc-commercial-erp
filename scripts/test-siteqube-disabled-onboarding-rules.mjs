import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/platform/organizations/new/page.tsx", "utf8");
const list = fs.readFileSync("app/platform/organizations/page.tsx", "utf8");
const availability = fs.readFileSync("app/api/platform/organizations/subdomain-availability/route.ts", "utf8");

for (const step of ["Organization", "Modules", "Default Roles", "Primary Administrator", "Domain", "Branding", "Review"]) assert.match(page, new RegExp(step));
assert.match(page, /subdomain-availability/);
assert.match(page, /Provision Organization/);
assert.match(page, /api\/platform\/organizations\/provision/);
assert.match(page, /submitting/);
assert.doesNotMatch(page, /api\/platform\/organizations\/provision\/invitation/);
assert.doesNotMatch(page, /api\/platform\/organizations\/\$\{.*\}\/(activate|activation-readiness)/);
assert.match(list, /\/platform\/organizations\/new/);
assert.match(availability, /requirePlatformOwner/);
console.log("SiteQube disabled onboarding UI rules: PASS");
