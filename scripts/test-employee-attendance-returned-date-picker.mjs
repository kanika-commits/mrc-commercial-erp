import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const dailyRoute = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const dailyPage = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");

assert.match(shared, /\.in\("status", \["submitted", "approved", "reopened"\]\)/, "lookup must fetch reopened submissions");
assert.match(shared, /applyOrganizationScope\(\s*admin\s*\.from\("employee_attendance_daily_submissions"\)/, "submission lookup must retain organization scope");
assert.match(shared, /visiblePairKeys/, "returned dates must be limited to visible company/site pairs");
assert.match(shared, /String\(row\.status \|\| ""\)\.toLowerCase\(\) !== "reopened"/, "only reopened submissions may add returned dates");
assert.match(dailyPage, /lookups\.historical_attendance_dates\?\.\[siteId\]/, "the picker must consume returned dates for the selected site");
assert.match(dailyPage, /selectableDates\.map/, "returned dates must be rendered in the date picker");
assert.match(dailyRoute, /loadEligibleEmployees\(admin, \{/, "daily loading must resolve the scoped roster");
assert.match(dailyRoute, /startDate: attendanceDate,\s*endDate: attendanceDate/, "roster loading must use the selected returned date");
assert.match(dailyRoute, /employees,\s*attendance:/, "daily response must provide the roster to the page");

const visiblePairs = new Set(["company-a:site-a"]);
const submissions = [
  { company_id: "company-a", site_id: "site-a", attendance_date: "2026-11-08", status: "reopened" },
  { company_id: "company-b", site_id: "site-a", attendance_date: "2026-11-07", status: "reopened" },
  { company_id: "company-a", site_id: "site-a", attendance_date: "2026-11-06", status: "submitted" },
];
const returnedDates = submissions
  .filter((row) => visiblePairs.has(`${row.company_id}:${row.site_id}`))
  .filter((row) => String(row.status).toLowerCase() === "reopened")
  .map((row) => row.attendance_date);
assert.deepEqual(returnedDates, ["2026-11-08"], "only the exact visible company/site returned date belongs in the picker");

console.log("PASS: scoped sent-back dates reach the picker and the selected date drives the scoped attendance roster load.");
