import assert from "node:assert/strict";
import fs from "node:fs";

const dailyPage = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");
const monthlyPage = fs.readFileSync("app/hr/attendance/monthly/page.tsx", "utf8");
const sharedApi = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const lookupsApi = fs.readFileSync("app/api/hr/attendance/lookups/route.ts", "utf8");
const policyApi = fs.readFileSync("app/api/hr/attendance/policy/route.ts", "utf8");
const policyPage = fs.readFileSync("app/settings/policies/employee-attendance/page.tsx", "utf8");
const policyMigration = fs.readFileSync("supabase/migrations/202607310003_create_employee_attendance_policies.sql", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");

assert.match(dailyPage, /PHASE1_ATTENDANCE_STATUSES/, "Daily page must use the Phase 1 status set");
assert.doesNotMatch(dailyPage, /[^A-Z0-9_]ATTENDANCE_STATUSES\.map/, "Daily page must not expose all database attendance statuses");
assert.match(dailyPage, />Employee</, "Daily table must show Employee");
assert.match(dailyPage, />Department</, "Daily table must show Department");
assert.match(dailyPage, />Designation</, "Daily table must show Designation");
assert.match(dailyPage, />Status</, "Daily table must show Status");
assert.doesNotMatch(dailyPage, />Employee Code</, "Daily table must not show Employee Code");
assert.doesNotMatch(dailyPage, />Remarks</, "Daily table must not show Remarks");
assert.match(dailyPage, /Load Attendance/, "Daily page must use Load Attendance label");
assert.match(dailyPage, /Mark All Present/, "Daily page must keep Mark All Present");
assert.match(dailyPage, /Save Draft/, "Daily page must rename Save Changes to Save Draft");
assert.doesNotMatch(dailyPage, /Save Changes/, "Daily page must not show Save Changes");
assert.match(dailyPage, /Submit Attendance/, "Daily page must submit from the daily entry surface");
assert.match(dailyPage, /\/api\/hr\/attendance\/periods\/\$\{periodId\}\/submit/, "Daily submit must reuse the existing period submit endpoint");

assert.doesNotMatch(monthlyPage, /periodAction\("submit"\)/, "Monthly page must not be the primary submit surface");
assert.match(monthlyPage, /Export CSV/, "Monthly page must retain export");
assert.match(monthlyPage, /Approve/, "Monthly page must retain approval action");
assert.match(monthlyPage, /Send Back/, "Monthly page must retain send back");
assert.match(monthlyPage, /Reopen/, "Monthly page must retain reopen");

assert.match(sharedApi, /loadEmployeeAttendanceLookups/, "Employee Attendance must have a dedicated lookup resolver");
assert.match(sharedApi, /employee_attendance_policies/, "Lookup resolver must include Employee Attendance policies");
assert.match(sharedApi, /EMPLOYEE_STANDARD_WORKING_HOURS/, "Employee Attendance policy responses must use the fixed 8-hour working-day constant");
assert.match(sharedApi, /standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS/, "Employee Attendance policy payloads must expose the fixed working day");
assert.match(sharedApi, /employee_employment_history/, "Lookup resolver must include employee employment history");
assert.match(sharedApi, /historyByEmployee/, "Lookup resolver must prefer usable current employment history per employee");
assert.match(sharedApi, /employeeRowsWithoutUsableHistory/, "Lookup resolver must fall back to employee master assignment only when no usable current history exists");
assert.match(sharedApi, /rowAppliesToDateRange\(row, today, today\)/, "Employee Attendance policy scopes must use current/effective employment history");
assert.match(sharedApi, /isEmployeeEligibleForDate\(row, today\)/, "Employee master fallback must respect joining and exit dates");
assert.match(sharedApi, /assignmentMatchesAccess/, "Lookup resolver must apply user access after employee/policy pairs are resolved");
assert.doesNotMatch(sharedApi, /sites\.company_id/, "Employee Attendance resolver must not use sites.company_id as the Company/Site source");
assert.match(sharedApi, /rowAppliesToDateRange/, "Employee eligibility must evaluate employment history effective dates");
assert.match(lookupsApi, /loadEmployeeAttendanceLookups/, "Lookup route must use the shared Employee Attendance resolver");

const attendanceLookupBlock = sharedApi.slice(
  sharedApi.indexOf("export async function loadEmployeeAttendanceLookups"),
  sharedApi.indexOf("export async function loadEmployeeAttendancePolicyLookups"),
);
const policyLookupBlock = sharedApi.slice(
  sharedApi.indexOf("export async function loadEmployeeAttendancePolicyLookups"),
  sharedApi.indexOf("export async function loadEmployeeAttendancePolicyForScope"),
);

assert.match(policyApi, /loadEmployeeAttendancePolicyLookups/, "Employee Attendance Policy must use the policy-specific master lookup");
assert.doesNotMatch(policyApi, /\bloadEmployeeAttendanceLookups\b(?!Policy)/, "Employee Attendance Policy must not reuse the daily attendance lookup");
assert.match(policyApi, /validateEmployeeAttendancePolicyScope/, "Employee Attendance Policy saves must use the policy-specific active-master scope validator");
assert.match(policyLookupBlock, /from\("companies"\)[\s\S]+\.eq\("status", "active"\)/, "Policy lookup must load active Company masters");
assert.match(policyLookupBlock, /from\("sites"\)[\s\S]+\.eq\("status", "active"\)/, "Policy lookup must load active Site masters");
assert.match(policyLookupBlock, /policyScopeMatchesAccess/, "Policy lookup must apply user access after loading active masters");
assert.doesNotMatch(policyLookupBlock, /hr_employees|employee_employment_history|employee_attendance_policies|sites\.company_id|work_orders/, "Policy dropdown options must not be derived from employees, policies, Work Orders or sites.company_id");
assert.match(sharedApi, /export async function validateEmployeeAttendancePolicyScope/, "Policy scope validation must be separate from daily attendance scope validation");
assert.match(sharedApi, /validateEmployeeAttendancePolicyScope[\s\S]+from\("companies"\)[\s\S]+\.eq\("status", "active"\)[\s\S]+from\("sites"\)[\s\S]+\.eq\("status", "active"\)/, "Policy save validation must reject inactive Company/Site masters");
assert.match(attendanceLookupBlock, /employee_employment_history/, "Daily attendance lookup must remain employment-assignment based");
assert.match(attendanceLookupBlock, /employeeRowsWithoutUsableHistory/, "Daily attendance lookup must preserve employee master fallback for employees without current history");

assert.match(policyMigration, /create table if not exists public\.employee_attendance_policies/, "Employee Attendance Policy table must be created");
assert.match(policyMigration, /attendance_method text not null default 'manual_hr_entry'/, "Policy must store manual HR entry method");
assert.match(policyMigration, /approval_workflow_code text not null default 'employee_attendance_period_approval'/, "Policy must reference the existing employee period workflow");
assert.match(policyMigration, /employee_attendance_policies_method_check check \(attendance_method in \('manual_hr_entry'\)\)/, "Phase 1 migration must not enable future attendance methods");
assert.doesNotMatch(policyMigration, /primary_operator|reopen_authority|effective_from|effective_to|gps|biometric|grace|payroll/i, "Phase 1 policy migration must not add future-scope fields");

assert.match(policyApi, /attendance_method: "manual_hr_entry"/, "Policy API must persist manual HR entry");
assert.match(policyApi, /approval_workflow_code: "employee_attendance_period_approval"/, "Policy API must not create a fixed approval chain");
assert.match(policyPage, /attendance_lock_rule: "configured_hours_after_day_end"/, "Policy save payload must use configured lock hours after day end");
assert.match(policyPage, /Manual HR Entry/, "Policy page must expose the Phase 1 method as read-only");
assert.match(policyPage, /Standard Working Day/, "Policy page must expose the fixed standard working day");
assert.match(policyPage, /EMPLOYEE_STANDARD_WORKING_HOURS/, "Policy page must render the shared fixed 8-hour value");
assert.match(policyPage, /Approval Levels/, "Policy page must show configurable approval levels");
assert.match(policyPage, /Lock After Hours/, "Policy page must show configurable lock hours");
assert.doesNotMatch(policyPage, /<ReadOnlyField label="Attendance Lock Rule"|<option value="finalized_period">/, "Policy page must not render the obsolete fixed lock rule");
assert.match(policyPage, /scope_company_id/, "Policy page must filter Site options by scoped Company/Site pairs, not Site master ownership");
assert.match(policyPage, /lookups\.policies\.length === 0/, "Configured Policies table must render persisted policies only");
assert.match(policyPage, /No Employee Attendance Policies have been configured\./, "Configured Policies table must not show fake Not configured rows");
assert.match(policyPage, /Only saved Employee Attendance policies are listed here\./, "Configured Policies copy must not imply unsaved assignment-derived scopes");
assert.doesNotMatch(policyPage, /policy\?\.status \|\| "Not configured"/, "Configured Policies table must not show assignment-derived fake policy statuses");
assert.match(appShell, /Employee Attendance Policy/, "Settings Policies navigation must include Employee Attendance Policy");
assert.match(authGuard, /\/settings\/policies\/employee-attendance[\s\S]+hr_employee_attendance_policy/, "Policy route guard must use standalone Employee Attendance Policy permission");

assert.match(dailyPage, /Working Day/, "Daily Employee Attendance must show the resolved working day");
assert.match(dailyPage, /policy\?\.standard_working_hours/, "Daily Employee Attendance must read the policy returned by the API");
assert.match(dailyPage, /scope_company_id/, "Daily Employee Attendance selectors must use scoped Company/Site pairs");
assert.match(monthlyPage, /Working Day/, "Monthly Employee Attendance must show the resolved working day");
assert.match(monthlyPage, /result\.policy\?\.standard_working_hours/, "Monthly Employee Attendance must read the policy returned by the API");
assert.match(monthlyPage, /scope_company_id/, "Monthly Employee Attendance selectors must use scoped Company/Site pairs");

console.log("Employee attendance Phase 1 UI and policy tests passed.");
