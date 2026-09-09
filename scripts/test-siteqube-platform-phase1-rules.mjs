import assert from "node:assert/strict";
import fs from "node:fs";

const foundation = fs.readFileSync("supabase/migrations/202609090002_siteqube_platform_phase1_foundation.sql", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609090004_siteqube_platform_phase1_compatibility_repair.sql", "utf8");
const context = fs.readFileSync("lib/serverTenantContext.ts", "utf8");

assert.match(foundation, /create table if not exists public\.organization_memberships/);
assert.match(migration, /create table if not exists public\.organization_domains/);
for (const table of ["organization_memberships", "organization_modules", "organization_domains"]) {
  assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security"), table + " must enable RLS");
  assert.match(migration, new RegExp("grant all on table public\\." + table + " to service_role"), table + " must be service-role only");
}

assert.match(foundation, /unique \(organization_id, user_id\)/);
assert.match(foundation, /unique \(organization_id, module_code\)/);
assert.match(migration, /organization_modules_organization_id_fkey/);
assert.match(migration, /organization_modules \(organization_id, enabled, module_code\)/);
assert.match(migration, /organization_domains_hostname_unique/);
assert.match(migration, /organization_domains_slug_unique/);
assert.match(migration, /organization_domains_identifier_required/);
assert.doesNotMatch(migration, /is_enabled/);
assert.doesNotMatch(migration, /insert into public\./);
assert.match(migration, /revoke all on table public\.organization_memberships from anon, authenticated/);
assert.match(migration, /revoke all on table public\.organization_modules from anon, authenticated/);
assert.match(migration, /revoke all on table public\.organization_domains from anon, authenticated/);

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
