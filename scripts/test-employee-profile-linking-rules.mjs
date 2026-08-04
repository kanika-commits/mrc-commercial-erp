import assert from "node:assert/strict";
import fs from "node:fs";

const adminUserHelper = fs.readFileSync("app/api/admin/users/_employeeLinking.ts", "utf8");
const adminAccessOptionsApi = fs.readFileSync("app/api/admin/access-options/route.ts", "utf8");
const adminCreateUserApi = fs.readFileSync("app/api/admin/create-user/route.ts", "utf8");
const adminUserApi = fs.readFileSync("app/api/admin/users/[id]/route.ts", "utf8");
const adminNewUserPage = fs.readFileSync("app/admin/users/new/page.tsx", "utf8");
const adminEditUserPage = fs.readFileSync("app/admin/users/[id]/page.tsx", "utf8");
const linkedEmployeeSelector = fs.readFileSync("components/admin/LinkedEmployeeSelector.tsx", "utf8");
const usersApi = fs.readFileSync("app/api/hr/employees/users/route.ts", "utf8");
const serverAudit = fs.readFileSync("lib/serverAudit.ts", "utf8");

assert.match(adminAccessOptionsApi, /loadActorOrganizationScope/, "Admin access options use actor organization scope");
assert.match(adminAccessOptionsApi, /loadEmployeeLinkOptions/, "Admin access options include eligible employee link candidates");
assert.match(adminAccessOptionsApi, /employeeOptions/, "Admin access options return employeeOptions");

assert.match(adminNewUserPage, /LinkedEmployeeSelector/, "Create User page renders the shared Linked Employee selector");
assert.match(adminNewUserPage, /required/, "Create User marks Linked Employee as mandatory");
assert.match(adminNewUserPage, /Select a linked employee\./, "Create User blocks submission without a linked employee before API call");
assert.match(adminNewUserPage, /linked_employee_id: linkedEmployeeId/, "Create User sends linked_employee_id to the API");

assert.match(adminCreateUserApi, /linked_employee_id/, "Create User API accepts linked_employee_id");
assert.match(adminCreateUserApi, /Linked Employee is required\./, "Create User API requires Linked Employee");
assert.match(adminCreateUserApi, /validateEmployeeCanLinkToUser/, "Create User validates the one-to-one employee link before saving");
assert.match(adminCreateUserApi, /setUserEmployeeLink/, "Create User links hr_employees.user_id during the save flow");
assert.match(adminCreateUserApi, /linked_employee_id: savedLink\.linked_employee_id/, "Create User returns the saved linked employee id");

assert.match(adminUserApi, /loadLinkedEmployeeForUser/, "Edit User GET loads the current linked employee");
assert.match(adminUserApi, /loadEmployeeLinkOptions/, "Edit User GET loads selectable employee options");
assert.match(adminUserApi, /linkedEmployee/, "Edit User GET returns linkedEmployee");
assert.match(adminUserApi, /employeeOptions/, "Edit User GET returns employeeOptions");
assert.match(adminUserApi, /hasLinkUpdate/, "Edit User supports link-only saves without resaving permissions");
assert.match(adminUserApi, /setUserEmployeeLink/, "Edit User reuses the server-side link helper");
assert.match(adminUserApi, /parseVisiblePermissionKeys/, "Edit User preserves Release 1 fail-closed visible permission key validation");
assert.match(adminUserApi, /permissionKey = `\$\{moduleCode\}:\$\{actionCode\}`/, "Edit User keeps colon-format permission keys");
assert.match(adminUserApi, /deleteVisibleUserPermissions/, "Edit User uses the scoped visible-permission delete helper");
assert.match(adminUserApi, /idsToDelete[\s\S]+delete\(\)[\s\S]+in\("id", idsToDelete\)/, "Edit User deletes only exact visible permission row ids");

assert.match(adminEditUserPage, /LinkedEmployeeSelector/, "Edit User page renders the shared Linked Employee selector");
assert.match(adminEditUserPage, /allowUnlink/, "Edit User allows unlinking through the same selector");
assert.match(adminEditUserPage, /Save Linked Employee/, "Edit User saves employee linking independently of role permissions");
assert.match(adminEditUserPage, /linked_employee_id: linkedEmployeeId \|\| null/, "Edit User sends linked_employee_id in a link-only payload");
assert.match(adminEditUserPage, /visible_permission_keys: visiblePermissionKeysForSave\(\)/, "Edit User access save still sends scoped visible permission keys");
assert.match(adminEditUserPage, /return `\$\{moduleCode\}:\$\{actionCode\}`/, "Edit User UI keeps colon-format permission keys");

assert.match(linkedEmployeeSelector, /Search by name, code or department/, "Linked Employee selector is searchable by name, employee code and department");
assert.match(linkedEmployeeSelector, /Already linked/, "Linked Employee selector shows already-linked employees");
assert.match(linkedEmployeeSelector, /employee\.already_linked && employee\.id !== value/, "Already-linked employees cannot be selected except the current link");
assert.match(linkedEmployeeSelector, /allowUnlink/, "Linked Employee selector supports unlinking for existing users");

assert.match(adminUserHelper, /from\("hr_employees"\)[\s\S]+eq\("status", "active"\)/, "Admin link helper only lists active employees");
assert.match(adminUserHelper, /employee_code[\s\S]+employee_name[\s\S]+department_id[\s\S]+user_id/, "Admin link helper loads employee code, name, department and current user link");
assert.match(adminUserHelper, /from\("hr_departments"\)[\s\S]+department_name/, "Admin link helper resolves department names without nested schema-cache joins");
assert.match(adminUserHelper, /This employee is already linked to another ERP user\./, "Admin link helper rejects employees linked to another user");
assert.match(adminUserHelper, /This ERP user is already linked to another active employee\./, "Admin link helper enforces one active employee per ERP user");
for (const action of ["erp_profile_linked", "erp_profile_unlinked", "erp_profile_changed"]) {
  assert.match(adminUserHelper, new RegExp(action), `Admin link helper audits ${action}`);
  assert.match(serverAudit, new RegExp(action), `Server audit action type allows ${action}`);
}

assert.match(usersApi, /employee\.user_id && !userIds\.includes/, "Employee user lookup preserves the current linked user even if inactive or outside normal active list");
assert.match(usersApi, /role_summary: roleSummaryByUserId\.get\(profile\.id\) \|\| null/, "Employee user lookup returns role summaries safely");
assert.doesNotMatch(usersApi, /roles\(role_name, role_code\)/, "Employee user lookup avoids nested user_roles to roles relationship");

for (const [label, source] of [
  ["Admin helper", adminUserHelper],
  ["Admin create", adminCreateUserApi],
  ["Admin edit", adminUserApi],
  ["Admin new page", adminNewUserPage],
  ["Admin edit page", adminEditUserPage],
]) {
  for (const forbidden of ["/labour", "labour_", "hr_attendance", "/reports", "store_management", "module-support", "/modules/support"]) {
    assert.ok(!source.includes(forbidden), `${label} must not import or reference ${forbidden}`);
  }
}

console.log("Employee profile linking rule tests passed.");
