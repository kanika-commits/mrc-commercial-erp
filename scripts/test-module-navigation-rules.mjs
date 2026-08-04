import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultNav = fs.readFileSync(path.join(root, "lib/defaultModuleNavigation.ts"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "app/api/admin/bootstrap/route.ts"), "utf8");
const moduleNavigation = fs.readFileSync(path.join(root, "app/api/admin/module-navigation/route.ts"), "utf8");
const modulesPage = fs.readFileSync(path.join(root, "app/modules/page.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "components/AppShell.tsx"), "utf8");

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
  "module-administration",
]) {
  if (!appShell.includes(token)) {
    throw new Error(`AppShell must preserve preferred nested sidebar structure with ${token}.`);
  }
}

for (const forbidden of ["settings-policies", "module-store-management", "module-support", "module-reports"]) {
  if (appShell.includes(forbidden)) {
    throw new Error(`AppShell must not expose unreleased nested sidebar group ${forbidden}.`);
  }
}

const reportsModulePage = fs.readFileSync(path.join(root, "app/modules/reports/page.tsx"), "utf8");
if (!reportsModulePage.includes("Release 1 reports workspace is not enabled yet") || reportsModulePage.includes("href=\"/reports\"")) {
  throw new Error("/modules/reports must show safe compatibility UX without linking to /reports.");
}

if (!modulesPage.includes("min-h-[124px]") || !modulesPage.includes("xl:grid-cols-4") || !modulesPage.includes("<span className=\"sr-only\">Open {module.title}</span>")) {
  throw new Error("/modules cards must preserve the compact launcher treatment from the Release 1 visual baseline.");
}

console.log("Module navigation rules passed.");
