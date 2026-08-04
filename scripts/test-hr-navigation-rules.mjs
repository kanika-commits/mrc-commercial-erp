import assert from "node:assert/strict";
import fs from "node:fs";

const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const hrSectionNav = fs.readFileSync("components/hr/HrSectionNav.tsx", "utf8");
const hrLauncher = fs.readFileSync("app/modules/hr/page.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const defaultNavigation = fs.readFileSync("lib/defaultModuleNavigation.ts", "utf8");
const labourContext = fs.readFileSync("lib/labour/attendanceSystemContext.ts", "utf8");

assert.match(appShell, /navLeaf\("Employee Registration", "hr_employees", "\/hr\/employees"\)/, "Sidebar Employee Registration leaf points to /hr/employees");
assert.match(appShell, /href: fallbackHref \|\| moduleRouteByCode\.get\(moduleCode\) \|\| "\/modules"/, "Sidebar explicit fallback route wins over duplicate module_code runtime rows");
assert.match(hrSectionNav, /<Link href="\/hr\/employees"[\s\S]+Employee Registration/, "HR top Employee Registration tab points to /hr/employees");
assert.match(hrLauncher, /title: "Employee Registration"[\s\S]+href: "\/hr\/employees"[\s\S]+moduleCode: "hr_employees"/, "HR launcher Employee Registration card points to /hr/employees");
assert.match(defaultNavigation, /id: "default-hr-employees"[\s\S]+module_code: "hr_employees"[\s\S]+module_name: "Employee Registration"[\s\S]+route: "\/hr\/employees"/, "Default navigation maps Employee Registration to /hr/employees");
assert.match(authGuard, /pathname === "\/hr\/employees"[\s\S]+can\(access\.permissions, "hr_employees", "view"\)/, "Direct /hr/employees guard uses hr_employees:view");
assert.match(appShell, /navLeaf\("Attendance Approval", "hr_attendance_approval", "\/hr\/attendance-approval"\)/, "Sidebar Employee Attendance Approval points to the live approval page");
assert.match(hrSectionNav, /href="\/hr\/attendance-approval"[\s\S]+Attendance Approval/, "HR top nav Employee Attendance Approval points to the live approval page");
assert.match(hrLauncher, /title: "Attendance Approval"[\s\S]+href: "\/hr\/attendance-approval"[\s\S]+moduleCode: "hr_attendance_approval"/, "HR launcher Employee Attendance Approval points to the live approval page");

assert.match(appShell, /navLeaf\("Departments", "hr_departments", "\/hr\/departments"\)/, "Departments uses the standalone HR Departments permission");
assert.match(appShell, /navLeaf\("Designations", "hr_designations", "\/hr\/designations"\)/, "Designations uses the standalone HR Designations permission");
assert.match(modulePage, /page\.route === "\/hr\/departments"[\s\S]+\? "hr_departments"[\s\S]+page\.route === "\/hr\/designations"[\s\S]+\? "hr_designations"/, "Module launcher keeps Departments and Designations metadata distinct from Employee Registration");

const sidebarEmployeeRegistrationMatches = appShell.match(/navLeaf\("Employee Registration", "hr_employees", "\/hr\/employees"\)/g) || [];
assert.equal(sidebarEmployeeRegistrationMatches.length, 1, "Sidebar has exactly one Employee Registration leaf");

assert.match(labourContext, /LABOUR_CONTEXT_STORAGE_KEY = "constructiq-labour-context"/, "Labour navigation must persist site-scoped workflow context");
assert.match(labourContext, /LABOUR_WORKSPACE_STORAGE_KEY = "constructiq-labour-workspace"/, "Labour navigation keeps accessible site-policy summary separate from selected site context");
assert.match(labourContext, /organization_id: string;[\s\S]+company_id: string;[\s\S]+site_id: string;[\s\S]+attendance_system: LabourAttendanceSystemValue;/, "Labour context must include site identifiers with attendance policy");
assert.match(labourContext, /function labourWorkflowForNavigation[\s\S]+context\?\.attendance_system[\s\S]+systems\.length === 1 \? systems\[0\] : null/, "Navigation may infer workflow only when all accessible sites share one configured system");
assert.match(labourContext, /isLabourRouteAllowedForAttendanceSystem/, "HR navigation must use the central Labour workflow policy helper");
assert.match(labourContext, /function resolveSingleLabourSiteId/, "Labour navigation must centralize single-site detection");
assert.match(labourContext, /function shouldShowLabourWorkspace/, "Labour navigation must centralize Attendance Workspace visibility");
assert.match(labourContext, /function selectedLabourContextIsValid/, "Labour navigation must reject stale stored Company/Site context");
assert.match(labourContext, /return attendanceSystem === "standard"/, "Standard Labour Attendance must require an explicitly standard selected site");
assert.match(labourContext, /return attendanceSystem === "site_in_engineer"/, "Site-In and Engineer Daily must require an explicitly System 2 selected site");
assert.match(appShell, /subscribeSelectedLabourContext\(setLabourContext\)/, "Sidebar must subscribe to scoped Labour context changes");
assert.match(appShell, /subscribeLabourWorkspaceSummary\(setLabourWorkspace\)/, "Sidebar must subscribe to accessible Labour workspace summary changes");
assert.match(appShell, /\/api\/labour\/lookups\?purpose=labour_workspace/, "Sidebar bootstrap must load the neutral site-scoped Labour workspace lookup");
assert.doesNotMatch(appShell, /summary\.pairs\.length === 1[\s\S]+writeSelectedLabourContext/, "Sidebar bootstrap must not auto-select Company from a single Company/Site pair");
assert.match(appShell, /isLabourRouteAllowedForAttendanceSystem\(moduleCode, labourWorkflow\)/, "Sidebar permission-filtered leaves must still pass workflow policy");
assert.match(hrSectionNav, /subscribeSelectedLabourContext\(setLabourContext\)/, "HR top nav must subscribe to scoped Labour context changes");
assert.match(hrSectionNav, /subscribeLabourWorkspaceSummary\(setLabourWorkspace\)/, "HR top nav must use the same accessible Labour workspace summary");
assert.match(hrLauncher, /subscribeSelectedLabourContext\(setLabourContext\)/, "HR launcher must subscribe to scoped Labour context changes");
assert.match(hrLauncher, /subscribeLabourWorkspaceSummary\(setLabourWorkspace\)/, "HR launcher must use the same accessible Labour workspace summary");
assert.match(appShell, /shouldShowLabourWorkspace\(labourWorkspace, globalAccess\)/, "Sidebar uses live Labour summary to conditionally show Attendance Workspace");
assert.match(appShell, /canViewAnyMusterModule\(\) && showLabourWorkspace[\s\S]+label: "Attendance Workspace"[\s\S]+href: "\/labour"/, "Sidebar hides Attendance Workspace for single-context normal users only");
assert.match(hrSectionNav, /shouldShowLabourWorkspace\(labourWorkspace, global\)/, "HR top nav uses the shared Labour Workspace visibility rule");
assert.match(hrSectionNav, /showLabourWorkspace &&[\s\S]+href="\/labour"[\s\S]+Attendance Workspace/, "HR top nav conditionally exposes Attendance Workspace");
assert.match(hrLauncher, /shouldShowLabourWorkspace\(labourWorkspace, global\)/, "HR launcher uses the shared Labour Workspace visibility rule");
assert.match(hrLauncher, /card\.moduleCode === "labour_workspace"[\s\S]+return showLabourWorkspace &&/, "HR launcher conditionally exposes Attendance Workspace");
assert.match(appShell, /navLeaf\("Employee Attendance Policy", "hr_employee_attendance_policy", "\/settings\/policies\/employee-attendance"\)/, "Settings Policies exposes Employee Attendance Policy with its standalone permission");
assert.match(appShell, /navLeaf\("Labour Attendance Policy", "labour_muster_configuration", "\/labour\/configuration"\)/, "Settings Policies exposes Labour Attendance Policy through the existing Muster Configuration route and permission");
assert.doesNotMatch(appShell, /navLeaf\("Muster Configuration", "labour_muster_configuration", "\/labour\/configuration"\)/, "Sidebar must not show the old Muster Configuration label");
assert.match(modulePage, /module_name: "Employee Attendance Policy"[\s\S]+route: "\/settings\/policies\/employee-attendance"/, "Settings launcher adds Employee Attendance Policy as a policy card");
assert.match(modulePage, /codes: \["hr_employee_attendance_policy", "labour_muster_configuration"\]/, "Settings Policies section contains exactly Employee and Labour attendance policy modules");
assert.match(hrLauncher, /isLabourRouteAllowedForAttendanceSystem\(card\.moduleCode, labourWorkflow\)/, "HR launcher must not re-add workflow-incompatible modules");
assert.doesNotMatch(appShell, /constructiq-labour-attendance-system/, "Sidebar must not use the old global attendance-system key");

console.log("HR navigation rule tests passed.");
