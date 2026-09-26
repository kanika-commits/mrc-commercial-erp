import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const reopen = fs.readFileSync("app/api/labour/attendance/periods/[id]/reopen/route.ts", "utf8");

assert.match(shared, /\.eq\("organization_id", input\.organizationId\)/);
assert.match(shared, /\.eq\("site_id", input\.siteId\)/);
assert.match(shared, /\.eq\("attendance_type", input\.attendanceType\)/);
assert.match(shared, /\.eq\("status", "open"\)/);
assert.match(shared, /\.is\("closed_at", null\)/);
assert.match(shared, /\.lte\("opens_at", now\)/);
assert.match(shared, /\.lte\("from_date", input\.attendanceDate\)/);
assert.match(shared, /\.gte\("to_date", input\.attendanceDate\)/);
assert.match(shared, /expires_at\.is\.null,expires_at\.gt/);
assert.match(shared, /company_id\.is\.null,company_id\.eq\.\$\{input\.companyId\}/);

assert.match(daily, /const explicitlyOpen = selectedStatus === "reopened" \|\| \(Boolean\(historicalAccess\) && !dateAuthority\.submittedSnapshotLocked\)/);
assert.match(daily, /historicalAccess = await getActiveHistoricalAttendanceAccess\(access, \{ organizationId, companyId, siteId/);
assert.match(daily, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted/);
assert.match(reopen, /status: "reopened"/);

console.log("Labour historical access roster rules: PASS");
