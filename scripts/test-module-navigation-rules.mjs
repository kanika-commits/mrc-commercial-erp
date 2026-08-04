import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultNav = fs.readFileSync(path.join(root, "lib/defaultModuleNavigation.ts"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "app/api/admin/bootstrap/route.ts"), "utf8");
const moduleNavigation = fs.readFileSync(path.join(root, "app/api/admin/module-navigation/route.ts"), "utf8");
const modulesPage = fs.readFileSync(path.join(root, "app/modules/page.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "components/AppShell.tsx"), "utf8");
const modulePage = fs.readFileSync(path.join(root, "components/ModulePage.tsx"), "utf8");
const registry = fs.readFileSync(path.join(root, "lib/releasedModuleRegistry.ts"), "utf8");

for (const file of [
  ["bootstrap", bootstrap],
  ["module-navigation", moduleNavigation],
]) {
  if (!file[1].includes("filterVisibleModuleNavigation")) {
    throw new Error(`${file[0]} API must filter navigation through the released registry.`);
  }
  if (!file[1].includes("applyCanonicalModuleGroupNames")) {
    throw new Error(`${file[0]} API must normalize released group names.`);
  }
}

for (const forbidden of ["labour_", "hr_attendance", "/reports/builder", "/modules/store-management", "/modules/support"]) {
  if (defaultNav.includes(forbidden) || modulesPage.includes(forbidden)) {
    throw new Error(`Module navigation must not expose ${forbidden}.`);
  }
}

if (!modulesPage.includes("/modules/reports")) {
  throw new Error("/modules/reports compatibility launcher must remain available.");
}

for (const token of [
  "expandedTopGroup",
  "expandedNestedGroups",
  "ChevronDown",
  "aria-expanded",
  "sidebarCollapsed",
  "mobileSidebarOpen",
  "PanelLeftClose",
  "PanelLeftOpen",
  "constructiq-sidebar-collapsed",
  "constructiq-sidebar-expanded-groups",
  "lg:w-[72px]",
  "lg:w-[240px]",
  "lg:pl-[72px]",
  "lg:pl-[240px]",
  "w-[min(82vw,280px)]",
  "h-[100dvh]",
]) {
  if (!appShell.includes(token)) {
    throw new Error(`AppShell must support preferred responsive collapsible sidebar behavior with ${token}.`);
  }
}

if (!appShell.includes("findActiveSidebarLeaf") || !appShell.includes("sort((first, second) => second.href.length - first.href.length)")) {
  throw new Error("AppShell must use longest matching child route for active sidebar state.");
}

if (appShell.includes("const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)")) {
  throw new Error("Sidebar child active state must not independently prefix-match every child.");
}

if (!appShell.includes("activeTopGroup.nested.forEach((id) => next.add(id))")) {
  throw new Error("The active sidebar group must automatically remain expanded.");
}

for (const token of ["Approvals", "Accounts/Finance", "Admin"]) {
  if (!appShell.includes(token) && !modulesPage.includes(token) && !registry.includes(`title: "${token}"`)) {
    throw new Error(`Navigation must use preferred Release 1 label ${token}.`);
  }
}


const hrOrder = [
  appShell.indexOf('releasedLeaf("hr_employees")'),
  appShell.indexOf('releasedLeaf("hr_employee_import")'),
  appShell.indexOf('releasedLeaf("reimbursements")'),
  appShell.indexOf('releasedLeaf("hr_departments")'),
  appShell.indexOf('releasedLeaf("hr_designations")'),
];
if (hrOrder.some((index) => index === -1) || !hrOrder.every((value, index, values) => index === 0 || values[index - 1] < value)) {
  throw new Error("Human Resources sidebar children must include Employee Registration, Employee Import, Reimbursements, Departments and Designations in order.");
}

const settingsSection = appShell.slice(appShell.indexOf('nested("settings-masters"'), appShell.indexOf('"/modules/settings"'));
if (settingsSection.includes('hr_departments') || settingsSection.includes('hr_designations')) {
  throw new Error("Settings Masters sidebar section must not contain HR Departments or Designations in Phase 4.");
}

const accountsOrder = [
  appShell.indexOf('releasedLeaf("invoices")'),
  appShell.indexOf('releasedLeaf("payments")'),
  appShell.indexOf('releasedLeaf("itc_claims")'),
];
if (accountsOrder.some((index) => index === -1) || !(accountsOrder[0] < accountsOrder[1] && accountsOrder[1] < accountsOrder[2])) {
  throw new Error("Accounts/Finance sidebar children must be ordered Invoices, Payments, ITC Review.");
}

for (const forbidden of [
  "attendanceSystemContext",
  "/api/labour/lookups",
  "href=\"/reports\"",
  "href=\"/labour",
  "href=\"/hr/attendance",
  "employeeAttendanceSentBack",
  "labourAttendanceSentBack",
]) {
  if (appShell.includes(forbidden)) {
    throw new Error(`AppShell must not reintroduce unreleased feature dependency ${forbidden}.`);
  }
}

for (const token of [
  "id: \"modules\"",
  "module-project-management",
  "module-purchase",
  "module-accounts",
  "module-hr",
  "module-settings",
  "settings-masters",
  `id: "administration"`,
]) {
  if (!appShell.includes(token)) {
    throw new Error(`AppShell must preserve preferred nested sidebar structure with ${token}.`);
  }
}

for (const forbidden of ["settings-policies", "module-store-management", "module-support", "module-reports", "module-administration"]) {
  if (appShell.includes(forbidden)) {
    throw new Error(`AppShell must not expose unreleased nested sidebar group ${forbidden}.`);
  }
}

const constructionManagementPage = fs.readFileSync(path.join(root, "app/construction-management/page.tsx"), "utf8");
if (constructionManagementPage.includes('href="/reports"')) {
  throw new Error("Construction Management compatibility page must not link to /reports.");
}

const reportsModulePage = fs.readFileSync(path.join(root, "app/modules/reports/page.tsx"), "utf8");
if (!reportsModulePage.includes("Release 1 reports workspace is not enabled yet") || reportsModulePage.includes("href=\"/reports\"")) {
  throw new Error("/modules/reports must show safe compatibility UX without linking to /reports.");
}

if (!modulesPage.includes("min-h-[124px]") || !modulesPage.includes("xl:grid-cols-4") || !modulesPage.includes("<span className=\"sr-only\">Open {module.title}</span>")) {
  throw new Error("/modules cards must preserve the compact launcher treatment from the Release 1 visual baseline.");
}

for (const token of ["CompactPageGrid", "SettingsSections", "rounded-xl border bg-gradient-to-br p-4", "hover:-translate-y-0.5", "grid gap-3 md:grid-cols-2 xl:grid-cols-4"]) {
  if (!modulePage.includes(token)) {
    throw new Error(`ModulePage must preserve compact visual parity token ${token}.`);
  }
}

for (const forbidden of ["labour_trades", "hr_employee_attendance_policy", "labour_muster_configuration", "settings_password"]) {
  if (modulePage.includes(forbidden)) {
    throw new Error(`ModulePage must not reintroduce unreleased settings section dependency ${forbidden}.`);
  }
}

console.log("Module navigation rules passed.");
