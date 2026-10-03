import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const monthly = fs.readFileSync("app/api/hr/attendance/monthly/route.ts", "utf8");
const approvals = fs.readFileSync("app/api/hr/attendance/approvals/route.ts", "utf8");
const approvalGroups = fs.readFileSync("app/api/hr/attendance/approval-groups/route.ts", "utf8");
const exportRoute = fs.readFileSync("app/api/hr/attendance/export/route.ts", "utf8");
const approvalExport = fs.readFileSync("app/api/hr/attendance/approval-groups/export/route.ts", "utf8");

assert.match(shared, /export async function loadEligibleEmployees/);
assert.match(shared, /historicalEmployeeIds\?: Iterable<string>/, "historical display IDs are explicit and cannot widen new-entry eligibility");
assert.match(shared, /if \(historicalEmployeeIds\.has\(employee\.id\)\) return true/);
assert.match(shared, /employeeStatus === "inactive"/);
assert.match(shared, /history\.effective_from \|\| history\.event_date/);
assert.match(shared, /dateForEligibility >= inactivation/);
assert.match(shared, /employeeStatus !== "active"/);
assert.match(shared, /\["active"\]\.includes\(String\(latestHistory\.employment_status/);
assert.match(shared, /\["active"\]\.includes\(String\(history\.employment_status/);
assert.match(shared, /return String\(employee\.status \|\| ""\)\.toLowerCase\(\) === "active"/);

assert.match(daily, /const eligibleIds = new Set\(employees\.map/);
assert.match(daily, /employeeIds\.some\(\(id\) => !eligibleIds\.has\(id\)\)/, "daily writes reject employees outside the active roster");
assert.match(daily, /historicalEmployees/);
assert.match(daily, /\["submitted", "approved"\]\.includes/);
assert.match(approvalExport, /historicalEmployeeIds: \[day\.employee_id\]/);

for (const [name, source] of Object.entries({ monthly, approvals, approvalGroups, exportRoute, approvalExport })) {
  assert.match(source, /loadEligibleEmployees/, `${name} uses shared eligibility`);
  assert.match(source, /historicalEmployeeIds: .*employee_id|historicalEmployeeIds: attendance\.map/, `${name} retains saved attendance employees for read-only output`);
}

console.log("Inactive employee attendance regression rules passed.");
