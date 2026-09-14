import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/platform/organizations/new/page.tsx", "utf8");
assert.match(page, /STEPS = \["Organization", "Modules", "Default Roles", "Primary Administrator", "Domain", "Branding", "Review"\]/);
assert.match(page, /displayName/);
assert.match(page, /tagline/);
assert.match(page, /primaryColor/);
assert.match(page, /secondaryColor/);
assert.match(page, /URL\.createObjectURL/);
assert.match(page, /image\/png,image\/jpeg,image\/webp/);
assert.match(page, /2 \* 1024 \* 1024/);
assert.match(page, /#\[0-9a-f\]\{6\}/i);
assert.match(page, /Branding display name/);
assert.match(page, /Logo selected/);
assert.match(page, /disabled title="Provisioning remains disabled"/);
assert.doesNotMatch(page, /\/api\/branding|\/api\/admin\/branding|supabase\.storage|provision_managed_organization|save_platform_role_template|rpc\(/);
assert.match(page, /organization, branding, user, invitation, DNS record, storage object, or RPC will be created/);
console.log("SiteQube branding onboarding rules: PASS");
