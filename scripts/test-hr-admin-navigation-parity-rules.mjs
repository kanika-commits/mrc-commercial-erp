import assert from "node:assert/strict";
import fs from "node:fs";

const registry = fs.readFileSync("lib/releasedModuleRegistry.ts", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const hrLauncher = fs.readFileSync("app/modules/hr/page.tsx", "utf8");
const adminLauncher = fs.readFileSync("app/modules/administration/page.tsx", "utf8");
const modulesPage = fs.readFileSync("app/modules/page.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const bootstrap = fs.readFileSync("app/api/admin/bootstrap/route.ts", "utf8");
const moduleNavigation = fs.readFileSync("app/api/admin/module-navigation/route.ts", "utf8");

const hrRoutes = [
  ["hr_employees", "/hr/employees", "hr"],
  ["hr_employee_import", "/hr/employees/import", "hr"],
  ["reimbursements", "/hr/reimbursements", "hr"],
  ["hr_departments", "/hr/departments", "hr"],
  ["hr_designations", "/hr/designations", "hr"],
];

for (const [code, route, group] of hrRoutes) {
  assert.match(registry, new RegExp(`code: "${code}"[^\n]+route: "${route}"[^\n]+group: "${group}"`), `${code} must be released under Human Resources`);
  assert.match(appShell, new RegExp(`releasedLeaf\\("${code}"\\)`), `${code} must be rendered through the sidebar released-leaf helper`);
}

const hrOrder = hrRoutes.map(([code]) => appShell.indexOf(`releasedLeaf("${code}")`));
assert.ok(hrOrder.every((index) => index !== -1), "all HR sidebar leaves must be present");
assert.ok(hrOrder.every((index, position) => position === 0 || hrOrder[position - 1] < index), "HR sidebar leaves must be in approved order");

assert.match(appShell, /id: "administration"/, "Admin must be a top-level sidebar group");
assert.doesNotMatch(appShell, /module-administration/, "Admin must not be nested under Modules");
for (const code of ["organizations", "users", "roles", "permissions"]) {
  assert.match(appShell, new RegExp(`releasedLeaf\\("${code}"\\)`), `${code} must appear under Admin`);
}

assert.match(hrLauncher, /groupCode="hr"/, "HR launcher must use the registry-backed HR ModulePage");
assert.match(adminLauncher, /Organizations/, "Admin launcher must keep Organizations card");
assert.match(adminLauncher, /Users/, "Admin launcher must keep Users card");
assert.match(adminLauncher, /Roles/, "Admin launcher must keep Roles card");
assert.match(adminLauncher, /Permissions/, "Admin launcher must keep Permissions card");
assert.match(modulesPage, /hr_departments/, "Main Modules launcher must consider Departments as HR access");
assert.match(modulesPage, /hr_designations/, "Main Modules launcher must consider Designations as HR access");

for (const source of [authGuard, bootstrap, moduleNavigation]) {
  assert.match(source, /releasedModuleRegistry|filterVisibleModuleNavigation|findReleasedRoute/, "route/bootstrap logic must use released metadata");
}

for (const forbidden of ["/labour", "/hr/attendance", "/hr/attendance-approval", "/reports/builder", "/modules/store-management", "/modules/support", "/settings/policies/"]) {
  assert.ok(registry.includes(forbidden) || !appShell.includes(forbidden), `${forbidden} must stay excluded from visible navigation`);
}

console.log("HR/Admin navigation parity rules passed.");
