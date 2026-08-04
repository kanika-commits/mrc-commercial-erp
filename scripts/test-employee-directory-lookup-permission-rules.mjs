import assert from "node:assert/strict";
import fs from "node:fs";

const employeeDirectory = fs.readFileSync("app/hr/employees/page.tsx", "utf8");
const lookupHook = fs.readFileSync("components/hr/useHrLookups.ts", "utf8");
const departmentsApi = fs.readFileSync("app/api/hr/departments/route.ts", "utf8");
const designationsApi = fs.readFileSync("app/api/hr/designations/route.ts", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const releasedRegistry = fs.readFileSync("lib/releasedModuleRegistry.ts", "utf8");

assert.match(employeeDirectory, /useHrLookups\(\{ includeEmployees: false \}\)/, "Employee Directory loads supporting HR lookup data through the shared hook");
assert.match(lookupHook, /\/api\/hr\/departments\?purpose=employee_lookup/, "Employee Directory department lookup uses the limited employee lookup purpose");
assert.match(lookupHook, /\/api\/hr\/designations\?purpose=employee_lookup/, "Employee Directory designation lookup uses the limited employee lookup purpose");

assert.match(departmentsApi, /purpose === "employee_lookup"[\s\S]+requirePermission\(request, "hr_employees", "view"\)/, "Department lookup purpose may be authorized by hr_employees:view");
assert.match(departmentsApi, /purpose === "employee_lookup" \? "id, organization_id, department_name, status"/, "Department employee lookup returns only display/filter fields");
assert.match(departmentsApi, /requirePermission\(request, MODULE_CODE, "view"\)/, "Standalone Department list still checks hr_departments:view first");
assert.match(departmentsApi, /export async function POST[\s\S]+requirePermission\(request, MODULE_CODE, "add"\)/, "Department add remains protected by hr_departments:add");

assert.match(designationsApi, /purpose === "employee_lookup"[\s\S]+requirePermission\(request, "hr_employees", "view"\)/, "Designation lookup purpose may be authorized by hr_employees:view");
assert.match(designationsApi, /purpose === "employee_lookup" \? "id, organization_id, department_id, designation_name, status"/, "Designation employee lookup returns only display/filter fields");
assert.match(designationsApi, /requirePermission\(request, MODULE_CODE, "view"\)/, "Standalone Designation list still checks hr_designations:view first");
assert.match(designationsApi, /export async function POST[\s\S]+requirePermission\(request, MODULE_CODE, "add"\)/, "Designation add remains protected by hr_designations:add");

assert.match(authGuard, /findReleasedRoute\(pathname\)/, "Direct HR master pages are guarded through the released route registry");
assert.match(releasedRegistry, /route: "\/hr\/departments"[\s\S]+permissionModule: "hr_departments"/, "Departments route uses standalone hr_departments permission");
assert.match(releasedRegistry, /route: "\/hr\/designations"[\s\S]+permissionModule: "hr_designations"/, "Designations route uses standalone hr_designations permission");

console.log("Employee Directory lookup permission rules passed.");
