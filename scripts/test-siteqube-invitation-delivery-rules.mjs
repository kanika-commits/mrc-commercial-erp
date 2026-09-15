import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync("lib/managedTenant/invitations.ts", "utf8");
const route = fs.readFileSync("app/api/platform/organizations/provision/invitation/route.ts", "utf8");
const detailApi = fs.readFileSync("app/api/platform/organizations/[id]/route.ts", "utf8");
const detailPage = fs.readFileSync("app/platform/organizations/[id]/page.tsx", "utf8");
const acceptance = fs.readFileSync("app/api/managed-tenant/invitations/accept/route.ts", "utf8");
const page = fs.readFileSync("app/invitations/accept/page.tsx", "utf8");

assert.match(service, /requirePlatformOwner/);
assert.match(service, /managed_tenant_invitations/);
assert.match(service, /inviteUserByEmail/);
assert.match(service, /status.*pending.*sent|\["pending", "sent"\]/s);
assert.match(service, /expires_at/);
assert.match(service, /\/invitations\/accept\?invitationId/);
assert.match(service, /update\(/);
assert.match(route, /POST/);
assert.match(detailApi, /managed_tenant_invitations/);
assert.match(detailPage, /Resend Administrator Invitation/);
assert.match(detailPage, /invitationId/);
assert.match(acceptance, /accept_managed_tenant_invitation/);
assert.match(acceptance, /SITEQUBE_TENANT_INVITES_ENABLED/);
assert.match(page, /invitationId/);
assert.match(page, /managed-tenant\/invitations\/accept/);
console.log("SiteQube invitation delivery rules: PASS");
