import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/approvals/page.tsx", "utf8");
const route = fs.readFileSync("app/api/labour/approvals/export/route.ts", "utf8");
const helper = fs.readFileSync("lib/labour/attendanceExport.ts", "utf8");

assert.match(page, /exportMonthly\(format: "pdf" \| "xlsx"\)/);
assert.match(page, /exportMonthly\("xlsx"\)/);
assert.match(page, /format, month: filters\.month, company_id: filters\.company_id, site_id: filters\.site_id, status: filters\.status/);
assert.match(route, /requireLabourPermission\(request, "labour_daily_submission", "view"\)/);
assert.match(route, /loadApprovedStandardMonthlyRegister/);
assert.match(route, /labourMonthlyAttendanceXlsx/);
assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(helper, /addWorksheet\("Monthly Attendance"\)/);
assert.match(helper, /addWorksheet\("Contractor Summary"\)/);
assert.match(helper, /addWorksheet\("Labour Monthly Summary"\)/);
assert.match(helper, /\["Contractor", "Labour Count", "OT Hours", "Bonus Hours", "Attendance Wage", "OT Amount", "Bonus Amount", "Total Earned"\]/);
assert.doesNotMatch(helper, /contractorHeader = contractorSheet\.addRow\(\[.*Present Days/);
assert.doesNotMatch(helper, /contractorHeader = contractorSheet\.addRow\(\[.*Absent Days/);
assert.doesNotMatch(helper, /contractorHeader = contractorSheet\.addRow\(\[.*Half Days/);
assert.match(helper, /legacy_dates/);
assert.match(helper, /row\.days\?\./);
assert.doesNotMatch(helper, /MONTHLY GRAND TOTALS/);

console.log("Monthly Labour Excel export rules passed.");
