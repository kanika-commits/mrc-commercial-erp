import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const route = read("app/api/reports/employees/route.ts");
const panel = read("components/reports/EmployeeReportsPanel.tsx");
const page = read("app/reports/page.tsx");
const columns = read("lib/reports/employeeColumns.ts");
const registry = read("lib/reports/reportRegistry.ts");

assert.match(route, /loadPermissionContext\(request\)/);
assert.match(route, /hasServerPermission\(auth, "reports", "view"\)/);
assert.match(route, /hasServerPermission\(auth, "hr_employees", "view"\)/);
assert.match(route, /applyOrganizationScope\(query, scope\)/);
assert.match(route, /loadActorAssignments\(db, auth\.user\.id\)/);
assert.match(route, /in\("site_id", allowedSites\)|in\("company_id", allowedCompanies\)/);
assert.match(route, /range\(0, EXPORT_LIMIT - 1\)/);
assert.match(route, /format === "excel"/);
assert.match(route, /format === "pdf"/);
assert.match(route, /Unable to load Employee Master Report/);
assert.doesNotMatch(route, /\b(?:aadhaar|pan|salary|bank_account|account_number)\b/i, "sensitive employee fields must not be in the report route");
assert.match(columns, /employee_code/);
assert.match(columns, /employee_name/);
assert.match(columns, /date_of_joining/);
assert.match(columns, /employment_type/);
assert.match(panel, /\/api\/reports\/employees/);
assert.match(panel, /Authorization: `Bearer/);
assert.match(panel, /company_id/);
assert.match(panel, /site_id/);
assert.match(panel, /department_id/);
assert.match(panel, /designation_id/);
assert.match(panel, /Download PDF/);
assert.match(panel, /Export Excel/);
assert.match(panel, /params\(format\)/);
assert.match(panel, /selected\.includes\(key\)/);
assert.match(route, /columns\.map\(\(column\) => \[column, row\[column\]\]\)/);
assert.match(route, /exportRows\(params\.get\("format"\), pageRows, columns\)/);
assert.match(columns, /DEFAULT_EMPLOYEE_COLUMNS/);
assert.match(route, /columns = selected\.length \? selected : DEFAULT_EMPLOYEE_COLUMNS/);
assert.match(panel, /setSelected\(\[\.\.\.DEFAULT_EMPLOYEE_COLUMNS\]\)/);
assert.match(registry, /company_id.*site_id.*department_id.*designation_id.*status.*employment_type/s);
for (const field of ["email", "phone", "personal_email", "personal_phone", "shift", "confirmation_date", "notice_period_from", "notice_period_to", "resignation_date", "date_of_birth", "gender", "nationality", "blood_group", "marital_status", "father_name", "mother_name", "spouse_name", "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone", "current_address_line1", "current_address_city", "permanent_address_line1", "permanent_address_city", "reporting_manager"]) {
  assert.match(columns, new RegExp(field), `ordinary employee field ${field} must be selectable`);
  assert.match(route, new RegExp(field), `ordinary employee field ${field} must be server-projected`);
  assert.match(panel, new RegExp(field), `ordinary employee field ${field} must be rendered`);
}
for (const restricted of ["employee_documents", "employee_salary_history", "hr_salary", "hr_audit"]) {
  assert.doesNotMatch(route, new RegExp(restricted), `restricted source ${restricted} must not be used by Employee Master`);
}
assert.match(page, /EmployeeReportsPanel/);
assert.match(page, /value="employee"/);
assert.match(page, /value="employee_master"/);
assert.match(panel, /Report Type/);
assert.match(panel, /Employee Master/);
assert.match(registry, /employee_master/);
assert.match(registry, /hr_employees.*view/s);

console.log("Employee Master report rules passed.");
