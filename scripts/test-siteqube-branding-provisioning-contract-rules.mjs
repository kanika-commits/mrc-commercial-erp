import assert from "node:assert/strict";
import fs from "node:fs";

const validation = fs.readFileSync("lib/platformProvisioning.ts", "utf8");
const server = fs.readFileSync("lib/platformProvisioningServer.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609150001_siteqube_managed_tenant_provisioning_reconciliation.sql", "utf8");
const onboarding = fs.readFileSync("app/platform/organizations/new/page.tsx", "utf8");

for (const field of ["displayName", "loginTagline", "primaryColor", "secondaryColor"]) assert.match(validation, new RegExp(field));
assert.match(validation, /branding\.loginTagline\.length > 160/);
assert.match(validation, /\^#\[0-9a-f\]\{6\}\$/i);
for (const parameter of ["p_branding_display_name", "p_branding_login_tagline", "p_branding_primary_color", "p_branding_secondary_color"]) assert.match(server, new RegExp(parameter));
assert.match(migration, /insert into public\.organization_branding/);
assert.match(migration, /values\s*\(\s*v_org_id/);
assert.match(migration, /security definer/);
assert.doesNotMatch(migration, /update public\.organization_branding/);
assert.doesNotMatch(migration, /MRC|3b65abde/i);
assert.match(onboarding, /URL\.createObjectURL/);
assert.doesNotMatch(onboarding, /\/api\/branding|supabase\.storage|FormData|p_branding_/);
assert.match(onboarding, /p_branding_display_name|branding: \{ displayName:/);
console.log("SiteQube branding provisioning contract rules: PASS");
