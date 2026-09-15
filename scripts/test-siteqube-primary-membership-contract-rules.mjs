import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609100002_siteqube_managed_tenant_invitation_acceptance.sql", "utf8");
const invariant = fs.readFileSync("supabase/migrations/202609100004_siteqube_primary_membership_contract.sql", "utf8");
const session = fs.readFileSync("lib/managedTenant/invitationSession.ts", "utf8");
const route = fs.readFileSync("app/api/managed-tenant/invitations/accept/route.ts", "utf8");

assert.match(migration, /v_is_primary boolean/);
assert.match(migration, /membership_status = 'active' and is_primary = true/);
assert.match(migration, /values \(v_invitation\.organization_id, p_auth_user_id, 'active', 'tenant_administrator', v_is_primary/);
assert.match(migration, /is_primary = public\.organization_memberships\.is_primary/);
assert.match(invariant, /create unique index if not exists organization_memberships_one_active_primary_idx/);
assert.match(invariant, /where membership_status = 'active' and is_primary = true/);
assert.match(session, /auth\.getUser\(token\)/);
assert.doesNotMatch(session, /loadPermissionContext|user_access_assignments|role_permissions/);
assert.match(route, /loadManagedInvitationSession/);
assert.doesNotMatch(route, /loadPermissionContext/);
assert.match(route, /SITEQUBE_TENANT_INVITES_ENABLED/);

console.log("SiteQube primary membership contract rules: PASS");
