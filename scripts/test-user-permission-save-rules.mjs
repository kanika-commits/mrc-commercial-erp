import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const userPage = fs.readFileSync(path.join(root, "app/admin/users/[id]/page.tsx"), "utf8");
const userApi = fs.readFileSync(path.join(root, "app/api/admin/users/[id]/route.ts"), "utf8");

const putStart = userApi.indexOf("export async function PUT(");
const patchStart = userApi.indexOf("export async function PATCH(");
if (putStart === -1 || patchStart === -1 || patchStart <= putStart) {
  throw new Error("Unable to isolate the user access PUT handler.");
}
const putHandler = userApi.slice(putStart, patchStart);

for (const token of [
  "visible_permission_keys: visiblePermissionKeysForSave()",
  "`${moduleCode}:${actionCode}`",
  "user_permissions: permissionRows",
]) {
  if (!userPage.includes(token)) {
    throw new Error(`User permissions client payload is missing ${token}.`);
  }
}

for (const token of [
  "parseVisiblePermissionKeys",
  "user_permissions must be an array.",
  "user_permissions contains an invalid or non-visible permission row.",
  "permission?.allowed !== true",
  "!visiblePermissionKeySet.has(permissionKey)",
  "isValidPermissionAction(moduleCode, actionCode)",
  "uniqueRows<PermissionRow>",
  "deleteVisibleUserPermissions(supabase, id, visiblePermissionKeys)",
]) {
  if (!putHandler.includes(token)) {
    throw new Error(`User permissions PUT handler is missing safety guard: ${token}.`);
  }
}

for (const token of [
  "visible_permission_keys is required for user permission updates.",
  "visible_permission_keys contains an invalid permission key.",
  "permissionKey.split(\":\")",
  "isValidPermissionAction(parts[0].trim(), parts[1].trim())",
]) {
  if (!userApi.includes(token)) {
    throw new Error(`User permissions API is missing visible key validation: ${token}.`);
  }
}

if (!putHandler.includes("const hasPermissionUpdate = Object.prototype.hasOwnProperty.call(body, \"user_permissions\")")) {
  throw new Error("Permission changes must be scoped to requests that explicitly include user_permissions.");
}

if (!putHandler.includes("const parsedVisiblePermissionKeys = hasPermissionUpdate") || !putHandler.includes("? parseVisiblePermissionKeys(visible_permission_keys)")) {
  throw new Error("visible_permission_keys must be required for permission updates only.");
}

if (putHandler.includes(".from(\"user_permissions\")\n        .delete()\n        .eq(\"user_id\", id)")) {
  throw new Error("User permissions PUT handler must not broad-delete all explicit user permissions.");
}

if (putHandler.includes("visiblePermissionKeys.length === 0 ||")) {
  throw new Error("Submitted permissions outside a non-empty visible key set must not be accepted.");
}

if (!userApi.includes(".select(\"id, module_code, action_code\")") || !userApi.includes(".in(\"module_code\", moduleCodes)") || !userApi.includes(".in(\"id\", idsToDelete)")) {
  throw new Error("Visible permission deletion must be scoped by visible module/action keys and concrete row ids.");
}

for (const hiddenCode of ["labour_", "hr_attendance", "reports"]) {
  if (putHandler.includes(hiddenCode)) {
    throw new Error(`User permission save logic must not special-case hidden module ${hiddenCode}.`);
  }
}

console.log("User permission save safety rules passed.");
