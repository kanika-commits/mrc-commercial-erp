import assert from "node:assert/strict";
import fs from "node:fs";

const lookup = fs.readFileSync("app/api/labour/lookups/route.ts", "utf8");
const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const daily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");

assert.match(lookup, /\.eq\("organization_id", scopeCheck\.organizationId\)/);
assert.match(lookup, /\.eq\("site_id", selectedSiteId\)/);
assert.match(lookup, /\.eq\("attendance_type", "labour"\)/);
assert.match(lookup, /\.eq\("status", "open"\)/);
assert.match(lookup, /\.is\("closed_at", null\)/);
assert.match(lookup, /\.lte\("opens_at", now\)/);
assert.match(lookup, /expires_at\.is\.null,expires_at\.gt/);
assert.match(lookup, /company_id\.is\.null,company_id\.eq\.\$\{selectedCompanyId\}/);
assert.match(lookup, /accessRowsQuery\.is\("company_id", null\)/);
assert.match(lookup, /historicalAttendanceDates = historicalAttendanceDates\.filter\(\(date\) => \["draft", "reopened"\]/);
assert.match(page, /lookups\.historical_attendance_dates/);
assert.match(page, /reopenedAttendanceDates/);
assert.match(daily, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted/);
assert.match(daily, /selectedStatus === "reopened" \|\| \(Boolean\(historicalAccess\) && !dateAuthority\.submittedSnapshotLocked\)/);

console.log("Labour historical date picker rules: PASS");
