import assert from "node:assert/strict";
import fs from "node:fs";

const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const rolePermissionsPage = fs.readFileSync("app/admin/permissions/page.tsx", "utf8");
const userPermissionsPage = fs.readFileSync("app/admin/users/[id]/page.tsx", "utf8");
const rolePermissionsApi = fs.readFileSync("app/api/admin/permissions/route.ts", "utf8");
const userPermissionsApi = fs.readFileSync("app/api/admin/users/[id]/route.ts", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/202608010001_add_standalone_hr_master_policy_permissions.sql", "utf8");

const hiddenModules = [
  "labour_import",
  "labour_attendance_policy",
  "labour_engineer_groups",
  "labour_work_logs",
  "labour_work_groups",
  "hr_employee_document_import",
  "labour_contractors",
  "labour_manpower_work_orders",
  "labour_attendance_import",
  "labour_wages",
  "labour_wage_approval",
  "labour_advances",
  "labour_overtime",
  "labour_rate_overrides",
  "labour_wage_rates",
  "hr_salary",
  "store_management",
  "support",
  "settings_password",
  "labour_workspace",
  "labour_attendance_approval",
  "labour_attendance_unlock",
  "labour_deployments",
  "labour_documents",
  "labour_photo_evidence",
];

const hiddenListSource = visibility.match(/const HIDDEN_PERMISSION_MODULES = new Set\(\[[\s\S]*?\]\);/)?.[0] || "";

for (const moduleCode of hiddenModules) {
  assert.match(
    hiddenListSource,
    new RegExp(`"${moduleCode}"`),
    `${moduleCode} must be hidden from visible permission assignment matrices`,
  );
}

for (const moduleCode of [
  "hr_employees",
  "hr_departments",
  "hr_designations",
  "hr_employee_import",
  "hr_attendance",
  "hr_attendance_approval",
  "hr_employee_attendance_policy",
  "reimbursements",
  "labour_workers",
  "labour_attendance",
  "labour_site_in",
  "labour_engineer_daily",
  "labour_daily_submission",
  "labour_muster_configuration",
  "labour_trades",
]) {
  assert.doesNotMatch(
    hiddenListSource,
    new RegExp(`"${moduleCode}"`),
    `${moduleCode} must remain available in the visible permission assignment matrix`,
  );
}

assert.match(rolePermissionsPage, /prepareVisiblePermissionModules\(moduleData \|\| \[\]\)/, "Role Permissions page must render modules through the ERP visible permission presentation");
assert.match(userPermissionsPage, /prepareVisiblePermissionModules\(result\.modules \|\| \[\]\)/, "User Permissions page must render modules through the ERP visible permission presentation");
assert.match(visibility, /VISIBLE_GROUP_ORDER = \[[\s\S]+"Dashboard"[\s\S]+"Project Management"[\s\S]+"Human Resources"[\s\S]+"Purchase"[\s\S]+"Accounts \/ Finance"[\s\S]+"Reports"[\s\S]+"Settings"[\s\S]+"Admin"/, "Visible permission groups must match the final assignable ERP structure");
assert.doesNotMatch(visibility, /"Store Management"[\s\S]*\] as const/, "Store Management must not appear as an empty placeholder permission group");
assert.match(visibility, /"Reports"/, "Reports must appear now that /reports is implemented");
assert.doesNotMatch(visibility, /"Support"[\s\S]*\] as const/, "Support must not appear as an empty placeholder permission group");
assert.doesNotMatch(visibility, /\|\|\s*"Support"/, "Unmapped permission modules must not fall back into Support");
assert.doesNotMatch(visibility, /visible_group: "Contract Management"/, "Contract Management must not be a visible permission group");
assert.doesNotMatch(visibility, /visible_group: "Labour Management"/, "Labour Management must not be a visible permission group");
assert.match(visibility, /work_orders: \{ visible_group: "Purchase"[\s\S]+visible_name: "Work Orders"/, "Work Orders must appear only under Purchase");
assert.match(visibility, /ra_bills: \{ visible_group: "Project Management"[\s\S]+visible_name: "RA Bills"/, "RA Bills must appear under Project Management");
assert.match(visibility, /debit_notes: \{ visible_group: "Project Management"[\s\S]+visible_name: "Debit Notes"/, "Debit Notes must appear under Project Management");
assert.match(visibility, /invoices: \{ visible_group: "Accounts \/ Finance"[\s\S]+visible_name: "Invoices"/, "Invoices must appear under Accounts / Finance");
assert.match(visibility, /itc_claims: \{ visible_group: "Accounts \/ Finance"[\s\S]+visible_name: "ITC Review"/, "ITC Review must appear under Accounts / Finance");
assert.match(visibility, /payments: \{ visible_group: "Accounts \/ Finance"[\s\S]+visible_name: "Payments"/, "Payments must appear under Accounts / Finance");
assert.match(visibility, /labour_workers: \{[\s\S]+visible_group: "Human Resources"[\s\S]+visible_name: "Labour Registration"/, "Labour Registration must appear under Human Resources");
assert.match(visibility, /labour_attendance: \{[\s\S]+visible_group: "Human Resources"[\s\S]+visible_name: "Labour Attendance"/, "Labour Attendance must be the editable Labour attendance row");
assert.match(visibility, /labour_daily_submission: \{[\s\S]+visible_name: "Labour Attendance Approval"[\s\S]+visible_actions: \["view", "pm_approve", "pm_send_back", "ho_approve", "ho_send_back", "final_override"\]/, "Labour Attendance Approval must expose only meaningful approval actions in the visible matrix");
assert.match(visibility, /hr_attendance: \{[\s\S]+visible_actions: \["view", "add", "edit", "submit", "override", "export"\]/, "Employee Attendance must expose view/add/edit/submit/override/export actions");
assert.match(visibility, /hr_attendance_approval: \{[\s\S]+visible_actions: \["view", "approve", "reject"\]/, "Employee Attendance Approval must expose its currently enforced approval and send-back actions");
assert.match(visibility, /labour_site_in: \{[\s\S]+visible_actions: \["view", "add", "correct_time"\]/, "Site-In must expose its current operational actions");
assert.doesNotMatch(visibility, /Muster \/ Labour -/, "Permission Matrix must use clean page names instead of Muster / Labour prefixes");
assert.doesNotMatch(visibility, /Muster \/ Labour - Attendance Workspace/, "Attendance Workspace must not be an assignable permission row");
assert.match(visibility, /labour_muster_configuration: \{[\s\S]+visible_group: "Settings"[\s\S]+Policies - Labour Attendance Policy/, "labour_muster_configuration must display as Labour Attendance Policy");
assert.match(visibility, /hr_departments: \{[\s\S]+visible_group: "Settings"[\s\S]+visible_name: "Masters - Departments"/, "Departments must be a real editable Settings master permission row");
assert.match(visibility, /hr_designations: \{[\s\S]+visible_group: "Settings"[\s\S]+visible_name: "Masters - Designations"/, "Designations must be a real editable Settings master permission row");
assert.match(visibility, /hr_employee_attendance_policy: \{[\s\S]+visible_group: "Settings"[\s\S]+visible_name: "Policies - Employee Attendance Policy"/, "Employee Attendance Policy must be a real editable Settings policy permission row");
assert.match(visibility, /hr_employee_import: \{[\s\S]+visible_name: "Employee Import"/, "Employee Import must remain its own visible permission row");
assert.doesNotMatch(visibility, /visible_name: "Muster Configuration"/, "Visible Permissions UI must not show the stale Muster Configuration label");
assert.doesNotMatch(visibility, /shared_note|Controlled by|Also controls|SUPPLEMENTAL_VISIBLE_PERMISSION_ROWS|hr_attendance_register_display|settings_departments_display|settings_designations_display|settings_employee_attendance_policy_display/, "Permission Matrix must not render informational or inherited presentation rows");
assert.match(rolePermissionsPage, /function visibleModuleCodesForSave\(\)[\s\S]+permissionModuleCode\(module\)[\s\S]+visible_module_codes: visibleModuleCodesForSave\(\)/, "Role permission save must send the effective visible module scope");
assert.match(userPermissionsPage, /function visibleModuleCodesForSave\(\)[\s\S]+permissionModuleCode\(module\)[\s\S]+visible_module_codes: visibleModuleCodesForSave\(\)/, "User permission save must send the effective visible module scope");
assert.match(rolePermissionsPage, /function visiblePermissionKeysForSave\(\)[\s\S]+availableActionsForDisplayModule\(module\)[\s\S]+visible_permission_keys: visiblePermissionKeysForSave\(\)/, "Role permission save must send the visible action scope so hidden actions survive");
assert.match(userPermissionsPage, /function visiblePermissionKeysForSave\(\)[\s\S]+availableActionsForDisplayModule\(module\)[\s\S]+visible_permission_keys: visiblePermissionKeysForSave\(\)/, "User permission save must send the visible action scope so hidden actions survive");
assert.doesNotMatch(visibility, /settings_password_display|Account - Change Password/, "Change Password must not appear in the editable permission matrix");
assert.match(rolePermissionsPage, /if \(module\.display_only && !module\.permission_module_code\) return \[\]/, "Role Permissions must render auth-only display rows without editable actions");
assert.match(userPermissionsPage, /if \(module\.display_only && !module\.permission_module_code\) return \[\]/, "User Permissions must render auth-only display rows without editable actions");
assert.match(rolePermissionsApi, /parseVisiblePermissionKeys[\s\S]+deleteScopedRolePermissions[\s\S]+visiblePermissionKeys\.includes\(`\$\{row\.module_code\}\.\$\{row\.action_code\}`\)/, "Role permission save must delete only visible module-action rows when scoped by the UI");
assert.match(userPermissionsApi, /parseVisiblePermissionKeys[\s\S]+deleteScopedUserPermissions[\s\S]+visiblePermissionKeys\.includes\(`\$\{row\.module_code\}\.\$\{row\.action_code\}`\)/, "User permission save must delete only visible module-action rows when scoped by the UI");
assert.match(rolePermissionsApi, /visiblePermissionKeys\.includes\(`\$\{String\(item\.module_code \|\| ""\)\}\.\$\{String\(item\.action_code \|\| ""\)\}`\)/, "Role permission save must reinsert only visible module-action rows");
assert.match(userPermissionsApi, /visiblePermissionKeys\.includes\(`\$\{String\(permission\.module_code \|\| ""\)\}\.\$\{String\(permission\.action_code \|\| ""\)\}`\)/, "User permission save must reinsert only visible module-action rows");
assert.match(authGuard, /pathname === "\/hr\/attendance-approval"[\s\S]+can\(access\.permissions, "hr_attendance_approval", "view"\)/, "Employee Attendance Approval route guard must require hr_attendance_approval:view");
assert.match(permissionMatrix, /labour_workers: \["view", "add", "edit", "delete", "upload", "import", "export", "change_deployment", "change_rate"\]/, "Labour Registration must expose import plus separately controlled deployment and rate-change actions");
assert.match(permissionMatrix, /hr_attendance: \["view", "add", "edit", "submit", "override", "export"\]/, "Employee Attendance must expose override separately from edit");
assert.match(permissionMatrix, /labour_site_in: \["view", "add", "correct_time"\]/, "Site-In must expose view/add/correct_time");
assert.match(permissionMatrix, /change_deployment: "Change Deployment"/, "Permission Matrix must label labour_workers:change_deployment clearly");
assert.match(permissionMatrix, /change_rate: "Change Rate"/, "Permission Matrix must label labour_workers:change_rate clearly");
assert.match(permissionMatrix, /hr_departments: \["view", "add", "edit", "delete"\]/, "Departments must expose only master-page actions");
assert.match(permissionMatrix, /hr_designations: \["view", "add", "edit", "delete"\]/, "Designations must expose only master-page actions");
assert.match(permissionMatrix, /hr_employee_attendance_policy: \["view", "add", "edit"\]/, "Employee Attendance Policy must expose only view/add/edit actions");
assert.doesNotMatch(appShell, /navLeaf\([^)]*"labour_workspace"/, "Labour Workspace must not be presented as a normal assignable permission leaf");
assert.doesNotMatch(visibility, /visible_name: "Salary"/, "Salary must stay out of the visible matrix until the standalone workflow is live");
assert.match(visibility, /reports: \{[\s\S]+visible_group: "Reports"[\s\S]+visible_name: "Reports"[\s\S]+visible_actions: \["view", "export"\]/, "Reports must expose view and export now that /reports is implemented");
assert.match(rolePermissionsPage, /function visibleModuleCodesForSave\(\)[\s\S]+Array\.from\([\s\S]+new Set\(/, "Role permission saves must write each real module code only once");
assert.match(userPermissionsPage, /function visibleModuleCodesForSave\(\)[\s\S]+Array\.from\([\s\S]+new Set\(/, "User permission saves must write each real module code only once");
assert.match(migration, /'settings', 'hr_departments', 'Departments', '\/hr\/departments'/, "Migration must create the Departments ERP module row");
assert.match(migration, /'settings', 'hr_designations', 'Designations', '\/hr\/designations'/, "Migration must create the Designations ERP module row");
assert.match(migration, /'settings', 'hr_employee_attendance_policy', 'Employee Attendance Policy', '\/settings\/policies\/employee-attendance'/, "Migration must create the Employee Attendance Policy ERP module row");
assert.match(migration, /'hr_employees', 'hr_departments', 'view'[\s\S]+'hr_employees', 'hr_designations', 'delete'/, "Migration must seed HR master permissions from hr_employees");
assert.match(migration, /'hr_attendance', 'hr_employee_attendance_policy', 'view'[\s\S]+'hr_attendance', 'hr_employee_attendance_policy', 'edit'/, "Migration must seed Employee Attendance Policy permissions from hr_attendance");
assert.match(migration, /insert into public\.user_permissions/, "Migration must transition explicit user overrides as well as role permissions");

console.log("Permission matrix cleanup rules passed.");
