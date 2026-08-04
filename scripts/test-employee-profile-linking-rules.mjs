import assert from "node:assert/strict";
import fs from "node:fs";

const editPage = fs.readFileSync("app/hr/employees/[id]/edit/page.tsx", "utf8");
const detailPage = fs.readFileSync("app/hr/employees/[id]/page.tsx", "utf8");
const employeeForm = fs.readFileSync("components/hr/EmployeeForm.tsx", "utf8");
const employeeApi = fs.readFileSync("app/api/hr/employees/[id]/route.ts", "utf8");
const usersApi = fs.readFileSync("app/api/hr/employees/users/route.ts", "utf8");
const adminUserHelper = fs.readFileSync("app/api/admin/users/_employeeLinking.ts", "utf8");
const adminAccessOptionsApi = fs.readFileSync("app/api/admin/access-options/route.ts", "utf8");
const adminCreateUserApi = fs.readFileSync("app/api/admin/create-user/route.ts", "utf8");
const adminUserApi = fs.readFileSync("app/api/admin/users/[id]/route.ts", "utf8");
const adminNewUserPage = fs.readFileSync("app/admin/users/new/page.tsx", "utf8");
const adminEditUserPage = fs.readFileSync("app/admin/users/[id]/page.tsx", "utf8");
const linkedEmployeeSelector = fs.readFileSync("components/admin/LinkedEmployeeSelector.tsx", "utf8");
const serverAudit = fs.readFileSync("lib/serverAudit.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202607280005_extend_employee_profile_link_audit_actions.sql", "utf8");
const employeeImport = fs.readFileSync("lib/hr/employeeImport.ts", "utf8");

assert.match(editPage, /apiFetch\(`\/api\/hr\/employees\/users\?employee_id=\$\{params\.id\}`\)/, "Employee edit page loads ERP profile options for the current employee");
assert.match(editPage, /user_id: values\.user_id \|\| null/, "Employee edit save can persist a selected profile or unlink with null");

assert.match(adminAccessOptionsApi, /loadEmployeeLinkOptions/, "Admin access options include active employee link candidates");
assert.match(adminCreateUserApi, /linked_employee_id/, "Create User accepts a linked employee id");
assert.match(adminCreateUserApi, /Linked Employee is required\./, "Create User requires Linked Employee");
assert.match(adminCreateUserApi, /validateEmployeeCanLinkToUser/, "Create User validates the one-to-one employee link before saving");
assert.match(adminCreateUserApi, /setUserEmployeeLink/, "Create User links hr_employees.user_id during the same save flow");
assert.match(adminUserApi, /linkedEmployee/, "Edit User GET returns the current linked employee");
assert.match(adminUserApi, /employeeOptions/, "Edit User GET returns employee link candidates");
assert.match(adminUserApi, /hasLinkUpdate/, "Edit User supports link-only saves without resaving permissions");
assert.match(adminUserApi, /setUserEmployeeLink/, "Edit User reuses the server-side link helper");
assert.match(adminNewUserPage, /LinkedEmployeeSelector/, "Create User page renders the shared Linked Employee selector");
assert.match(adminNewUserPage, /required/, "Create User marks Linked Employee as mandatory");
assert.match(adminNewUserPage, /linked_employee_id: linkedEmployeeId/, "Create User sends the selected employee with the create request");
assert.match(adminEditUserPage, /LinkedEmployeeSelector/, "Edit User page renders the shared Linked Employee selector");
assert.match(adminEditUserPage, /allowUnlink/, "Edit User allows unlinking through the same selector");
assert.match(adminEditUserPage, /Save Linked Employee/, "Edit User saves employee linking independently of role permissions");
assert.match(linkedEmployeeSelector, /Search by name, code or department/, "Linked Employee selector is searchable by name, employee code and department");
assert.match(linkedEmployeeSelector, /Already linked/, "Linked Employee selector shows already-linked employees");
assert.match(linkedEmployeeSelector, /employee\.already_linked && employee\.id !== value/, "Already-linked employees cannot be selected except the current link");
assert.match(adminUserHelper, /from\("hr_employees"\)[\s\S]+eq\("status", "active"\)/, "Admin link helper only lists active employees");
assert.match(adminUserHelper, /employee_code[\s\S]+employee_name[\s\S]+department_id[\s\S]+user_id/, "Admin link helper loads employee code, name, department and current user link");
assert.match(adminUserHelper, /from\("hr_departments"\)[\s\S]+department_name/, "Admin link helper resolves department names without nested schema-cache joins");
assert.match(adminUserHelper, /This employee is already linked to another ERP user\./, "Admin link helper rejects employees linked to another user");
assert.match(adminUserHelper, /This ERP user is already linked to another active employee\./, "Admin link helper enforces one active employee per ERP user");
for (const action of ["erp_profile_linked", "erp_profile_unlinked", "erp_profile_changed"]) {
  assert.match(adminUserHelper, new RegExp(action), `Admin link helper audits ${action}`);
}

assert.match(employeeForm, /ERP Login/, "Employee edit form exposes the compact ERP Login section");
assert.match(employeeForm, /Search ERP Profile/, "ERP profile picker is searchable by visible text");
assert.match(employeeForm, /Search by name or email/, "ERP profile picker advertises name/email search");
assert.match(employeeForm, /form\.user_id \? "Linked" : "Not Linked"/, "ERP Login section shows linked versus not-linked state");
assert.match(employeeForm, /Profile Name[\s\S]+Profile Email[\s\S]+Profile Status[\s\S]+Current Roles/, "ERP Login section shows safe profile identity and role summary");
assert.match(employeeForm, /Already linked to another employee/, "Already-linked profiles are visible with an unavailable label");
assert.match(employeeForm, /const disabled = !isCurrentLink && \(isLinkedElsewhere \|\| isInactive\)/, "Inactive or already-linked profiles cannot be newly selected");
assert.match(employeeForm, /Unlink ERP Profile/, "Employee edit form exposes unlink without a new page");
assert.match(employeeForm, /user_id: ""/, "Employee edit unlink clears only the profile link field");

assert.match(usersApi, /from\("profiles"\)[\s\S]+select\("id, email, full_name, status"\)/, "Profile options come from ERP profiles");
assert.match(usersApi, /\.or\(`status\.eq\.active,id\.eq\.\$\{employee\.user_id/, "Profile options list active profiles while preserving the current linked profile");
assert.match(usersApi, /from\("hr_employees"\)[\s\S]+neq\("status", "deleted"\)[\s\S]+not\("user_id", "is", null\)/, "Profile options detect links to other active/non-deleted employees");
assert.match(usersApi, /from\("user_roles"\)[\s\S]+select\("user_id, role_id"\)/, "Profile options load user-role links without nested PostgREST relationships");
assert.match(usersApi, /from\("roles"\)[\s\S]+select\("id, role_name, role_code"\)/, "Profile options load role names separately like Admin Users");
assert.doesNotMatch(usersApi, /roles\(role_name, role_code\)/, "Profile options do not use the failing user_roles to roles nested relationship");
assert.match(usersApi, /const roleById = new Map[\s\S]+roleById\.get\(row\.role_id\)/, "Profile role summaries are mapped in TypeScript");
assert.match(usersApi, /role_summary: roleSummaryByUserId\.get\(profile\.id\) \|\| null/, "Role summary is returned safely to the edit/detail UI");

assert.match(employeeApi, /const auth = await requirePermission\(request, MODULE_CODE, "edit"\)/, "Employee update keeps existing hr_employees:edit permission enforcement");
assert.match(employeeApi, /function validateLinkedUser/, "Employee update validates ERP profile links server-side");
assert.match(employeeApi, /if \(userId === currentUserId\) return null/, "Current linked profile remains saveable for ordinary employee edits");
assert.match(employeeApi, /from\("profiles"\)[\s\S]+select\("id, email, full_name, status"\)[\s\S]+eq\("id", userId\)/, "Employee update verifies the selected ERP profile exists");
assert.match(employeeApi, /profile\.status !== "active"/, "Employee update rejects inactive profiles for new links");
assert.match(employeeApi, /user_access_assignments[\s\S]+eq\("organization_id", organizationId\)/, "Employee update verifies selected profile belongs to the employee organization scope");
assert.match(employeeApi, /neq\("id", currentEmployeeId\)[\s\S]+neq\("status", "deleted"\)/, "Employee update checks duplicate links against other active/non-deleted employees");
assert.match(employeeApi, /This ERP profile is already linked to another employee\./, "Employee update returns the approved duplicate-profile conflict message");
assert.match(employeeApi, /profileLinkChanged[\s\S]+erp_profile_changed[\s\S]+erp_profile_linked[\s\S]+erp_profile_unlinked/, "Employee update audits link, unlink and change actions");
assert.match(employeeApi, /profileAuditValue\(previousProfile\)[\s\S]+profileAuditValue\(nextProfile\)/, "Employee profile-link audit stores only safe profile id/email/status values");
assert.match(employeeApi, /profileLinkChanged[\s\S]+insertErpAuditLog/, "Audit is written only when the profile link changes");

assert.match(detailPage, /SectionCard title="ERP Login"/, "Employee detail page shows a read-only ERP Login summary");
assert.match(detailPage, /Profile Email[\s\S]+Profile Status[\s\S]+Current Roles/, "Employee detail summary includes safe linked profile fields");
assert.match(detailPage, /Link Status[\s\S]+Not Linked/, "Employee detail summary shows not-linked state");

for (const action of ["erp_profile_linked", "erp_profile_unlinked", "erp_profile_changed"]) {
  assert.match(serverAudit, new RegExp(action), `Server audit type allows ${action}`);
  assert.match(migration, new RegExp(action), `Audit action migration allows ${action}`);
}

assert.doesNotMatch(employeeImport, /user_id|ERP Login|ERP Profile/i, "Employee Import remains unchanged for manual profile linking");

console.log("Employee profile linking rule tests passed.");
