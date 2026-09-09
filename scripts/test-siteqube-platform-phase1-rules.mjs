import assert from "node:assert/strict";
import fs from "node:fs";

const bootstrap = fs.readFileSync("supabase/migrations/202609090005_siteqube_platform_phase1_bootstrap_compatibility.sql", "utf8");
const compatibility = fs.readFileSync("supabase/migrations/202609090004_siteqube_platform_phase1_compatibility_repair.sql", "utf8");
const context = fs.readFileSync("lib/serverTenantContext.ts", "utf8");

for (const table of ["organization_memberships", "organization_modules", "organization_domains"]) {
  assert.match(bootstrap, new RegExp("create table if not exists public\\." + table), table + " must be bootstrapped additively");
}
for (const table of ["organization_memberships", "organization_modules", "organization_domains"]) {
  assert.match(bootstrap, new RegExp("alter table public\\." + table + " enable row level security"), table + " must enable RLS");
  assert.match(bootstrap, new RegExp("grant all on table public\\." + table + " to service_role"), table + " must be service-role only");
}

assert.match(bootstrap, /unique \(organization_id, user_id\)/);
assert.match(bootstrap, /unique \(organization_id, module_code\)/);
assert.match(bootstrap, /organization_memberships_organization_id_fkey/);
assert.match(bootstrap, /organization_memberships_user_id_fkey/);
assert.match(bootstrap, /organization_modules_organization_id_fkey/);
assert.match(bootstrap, /organization_modules \(organization_id, enabled, module_code\)/);
assert.match(bootstrap, /organization_domains_hostname_unique/);
assert.match(bootstrap, /organization_domains_slug_unique/);
assert.match(bootstrap, /organization_domains_identifier_required/);
assert.doesNotMatch(bootstrap, /is_enabled/);
assert.doesNotMatch(bootstrap, /insert into public\./);
assert.match(bootstrap, /revoke all on table public\.organization_memberships from anon, authenticated/);
assert.match(bootstrap, /revoke all on table public\.organization_modules from anon, authenticated/);
assert.match(bootstrap, /revoke all on table public\.organization_domains from anon, authenticated/);
assert.doesNotMatch(bootstrap, /drop table|delete from|update public\./i);
assert.match(compatibility, /organization_modules/);
assert.doesNotMatch(compatibility, /is_enabled/);
assert.doesNotMatch(context, /202609090002|siteqube_platform_phase1_foundation/);

assert.match(context, /export type TenantContext/);
assert.match(context, /loadActiveAccountContext/);
assert.match(context, /resolveTenantContext/);
assert.match(context, /organization_memberships/);
assert.match(context, /organization_modules/);
assert.match(context, /eq\("enabled", true\)/);
assert.doesNotMatch(context, /is_enabled/);
assert.match(context, /isPlatformOwner/);
assert.match(context, /if \(!organizationId\) return null/);
assert.doesNotMatch(context, /requireOrganizationModule|hasServerPermission|return failure/);

console.log("SiteQube platform Phase 1 foundation rules passed.");
