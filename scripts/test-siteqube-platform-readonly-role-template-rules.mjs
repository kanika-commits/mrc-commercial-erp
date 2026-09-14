import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/platform/role-templates/route.ts", "utf8");
const page = fs.readFileSync("app/platform/role-templates/page.tsx", "utf8");
const onboarding = fs.readFileSync("app/platform/organizations/new/page.tsx", "utf8");
const shell = fs.readFileSync("app/platform/PlatformShell.tsx", "utf8");

assert.match(route, /export async function GET/);
assert.match(route, /requirePlatformOwner/);
assert.match(route, /platform_role_templates/);
assert.match(route, /platform_role_template_permissions/);
assert.doesNotMatch(route, /export async function (POST|PATCH|DELETE)/);
assert.doesNotMatch(route, /role_permissions|save_platform_role_template|rpc\(/);
assert.match(page, /Default Roles &amp; Permissions/);
assert.doesNotMatch(page, /Add Template|Edit role template|Save Template|onSubmit|method:\s*["'](POST|PATCH|DELETE)/);
assert.match(onboarding, /api\/platform\/role-templates/);
assert.match(onboarding, /roleTemplateIds/);
assert.match(onboarding, /toggleTemplate/);
assert.match(onboarding, /Selected default roles/);
assert.match(onboarding, /disabled title="Provisioning remains disabled"/);
assert.match(shell, /Default Roles/);
assert.match(shell, /\/platform\/role-templates/);
console.log("SiteQube read-only role-template rules: PASS");
