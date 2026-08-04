import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rolePage = fs.readFileSync(path.join(root, "app/admin/permissions/page.tsx"), "utf8");
const roleApi = fs.readFileSync(path.join(root, "app/api/admin/permissions/route.ts"), "utf8");

for (const token of [
  "visible_permission_keys: visiblePermissionKeysForSave()",
  "permissions: permissionRowsForSave()",
  "`${moduleCode}:${actionCode}`",
  "permissionKey(moduleCode, action)",
]) {
  if (!rolePage.includes(token)) {
    throw new Error(`Role permission client payload is missing ${token}.`);
  }
}

if (rolePage.includes("visible_module_codes")) {
  throw new Error("Role permission client must not send visible_module_codes for deletion scope.");
}

for (const token of [
  "parseVisiblePermissionKeys",
  "visible_permission_keys is required for role permission updates.",
  "visible_permission_keys contains an invalid permission key.",
  "permissionKey.split(\":\")",
  "isValidPermissionAction(parts[0].trim(), parts[1].trim())",
  "permissions must be an array.",
  "permissions contains an invalid or non-visible permission row.",
  "!visiblePermissionKeySet.has(permissionKey)",
  "deleteVisibleRolePermissions(admin, roleId, visiblePermissionKeys)",
  "new Map<string, PermissionRow>()",
]) {
  if (!roleApi.includes(token)) {
    throw new Error(`Role permission API is missing safety guard: ${token}.`);
  }
}

if (roleApi.includes("visibleModuleCodes") || roleApi.includes("visible_module_codes")) {
  throw new Error("Role permission API must not fall back to visible module codes.");
}

if (roleApi.includes("split(\".\")") || roleApi.includes("`${row.module_code}.${row.action_code}`")) {
  throw new Error("Role permission API must validate visible keys with module_code:action_code format.");
}

if (roleApi.includes(".from(\"role_permissions\")\n      .delete()\n      .eq(\"role_id\", roleId)")) {
  throw new Error("Role permission API must not broad-delete by role_id.");
}

if (!roleApi.includes('.select("id, module_code, action_code")') || !roleApi.includes('.in("module_code", moduleCodes)') || !roleApi.includes('.in("id", idsToDelete)')) {
  throw new Error("Role permission deletion must be scoped through exact visible keys and concrete row ids.");
}

for (const hiddenCode of ["labour_", "hr_attendance", "reports"]) {
  const putStart = roleApi.indexOf("export async function PUT(");
  const putHandler = roleApi.slice(putStart);
  if (putHandler.includes(hiddenCode)) {
    throw new Error(`Role permission save logic must not special-case hidden module ${hiddenCode}.`);
  }
}

console.log("Role permission save safety rules passed.");
