import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const matrix = fs.readFileSync(path.join(root, "lib/permissionMatrix.ts"), "utf8");
const visibility = fs.readFileSync(path.join(root, "lib/permissionVisibility.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/permissions/page.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "app/api/admin/permissions/route.ts"), "utf8");
const registry = fs.readFileSync(path.join(root, "lib/releasedModuleRegistry.ts"), "utf8");
const userEditPage = fs.readFileSync(path.join(root, "app/admin/users/[id]/page.tsx"), "utf8");
const userNewPage = fs.readFileSync(path.join(root, "app/admin/users/new/page.tsx"), "utf8");
const userApi = fs.readFileSync(path.join(root, "app/api/admin/users/[id]/route.ts"), "utf8");

for (const code of ["hr_departments", "hr_designations"]) {
  if (!matrix.includes(`${code}: [\"view\", \"add\", \"edit\", \"delete\"]`)) {
    throw new Error(`${code} must have standalone released actions.`);
  }
}

for (const token of ["labour_", "hr_attendance", "hr_employee_attendance_policy", "store_management", "support"]) {
  if (visibility.includes(`${token}:`) || visibility.includes(`\"${token}\"`)) {
    throw new Error(`Permission visibility must not expose ${token}.`);
  }
}

const expectedGroupOrder = [
  "Dashboard",
  "Project Management",
  "Purchase",
  "Accounts / Finance",
  "Human Resources",
  "Settings",
  "Administration",
];
const groupOrderIndex = visibility.indexOf(`const groupOrder = [`);
let previousIndex = groupOrderIndex;
for (const groupName of expectedGroupOrder) {
  const nextIndex = visibility.indexOf(`\"${groupName}\"`, previousIndex);
  if (nextIndex === -1) {
    throw new Error(`Permission Matrix must include friendly group label ${groupName}.`);
  }
  if (nextIndex < previousIndex) {
    throw new Error(`Permission Matrix group label ${groupName} is out of order.`);
  }
  previousIndex = nextIndex;
}

for (const rawGroup of ["administration", "contract_management", "project_management"]) {
  if (visibility.includes(`module_group: \"${rawGroup}\"`)) {
    throw new Error(`Permission Matrix must not present raw group code ${rawGroup}.`);
  }
}

const expectedMappings = [
  ["ra_bills", "Project Management"],
  ["debit_notes", "Project Management"],
  ["ra_approval", "Project Management"],
  ["work_orders", "Purchase"],
  ["wo_approval", "Purchase"],
  ["invoices", "Accounts / Finance"],
  ["itc_claims", "Accounts / Finance"],
  ["payments", "Accounts / Finance"],
  ["hr_employees", "Human Resources"],
  ["hr_employee_import", "Human Resources"],
  ["reimbursements", "Human Resources"],
  ["companies", "Settings"],
  ["sites", "Settings"],
  ["vendors", "Settings"],
  ["company_bank_accounts", "Settings"],
  ["hr_departments", "Settings"],
  ["hr_designations", "Settings"],
  ["organizations", "Administration"],
  ["users", "Administration"],
  ["roles", "Administration"],
  ["permissions", "Administration"],
];
for (const [moduleCode, groupLabel] of expectedMappings) {
  const moduleIndex = registry.indexOf(`code: \"${moduleCode}\"`);
  const groupIndex = registry.indexOf(`title: \"${groupLabel}\"`);
  if (moduleIndex === -1 || groupIndex === -1) {
    throw new Error(`Released registry must support ${moduleCode} under ${groupLabel}.`);
  }
}

for (const token of ["prepareVisiblePermissionModules", "visible_permission_keys"]) {
  if (!page.includes(token)) {
    throw new Error(`Permission page must use ${token}.`);
  }
}

if (!userEditPage.includes("prepareVisiblePermissionModules(result.modules || [])")) {
  throw new Error("User edit permission matrix must use friendly Release 1 permission grouping.");
}

if (!userEditPage.includes("visible_permission_keys: visiblePermissionKeysForSave()")) {
  throw new Error("User edit permission saves must submit visible permission keys.");
}

if (!userEditPage.includes("`${moduleCode}:${actionCode}`")) {
  throw new Error("User edit permission keys must use module_code:action_code format.");
}

if (!userApi.includes("deleteVisibleUserPermissions") || !userApi.includes("visiblePermissionKeys")) {
  throw new Error("User permission API must preserve hidden permissions by deleting only visible permission keys.");
}

if (!userApi.includes("visible_permission_keys is required for user permission updates.")) {
  throw new Error("User permission API must fail closed when visible_permission_keys is missing or empty.");
}

if (userApi.includes("`${row.module_code}.${row.action_code}`") || userApi.includes("split(\".\")")) {
  throw new Error("User permission API must validate visible keys with module_code:action_code format.");
}

for (const rawCode of ["administration", "contract_management", "dashboard"]) {
  if (userEditPage.includes(`<h3 className=\"font-semibold text-gray-700\">${rawCode}</h3>`)) {
    throw new Error(`User edit permission matrix must not render raw group code ${rawCode}.`);
  }
  if (userNewPage.includes(`<h3 className=\"font-semibold text-gray-700\">${rawCode}</h3>`)) {
    throw new Error(`New user page must not render raw group code ${rawCode}.`);
  }
}

if (userNewPage.includes("User Permissions") || userNewPage.includes("module_group")) {
  throw new Error("New user page must not reintroduce a separate raw permission matrix.");
}

if (api.includes(".delete()") && api.includes(".eq(\"role_id\", roleId);")) {
  throw new Error("Permission API must not broadly delete all role permissions.");
}

for (const token of ["deleteVisibleRolePermissions", "visiblePermissionKeys", "isValidPermissionAction", "uniqueRows"]) {
  if (!api.includes(token)) {
    throw new Error(`Permission API is missing ${token}.`);
  }
}

console.log("Permission Matrix cleanup rules passed.");
