import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
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
assert.match(page, /const historicalDateOpen = Boolean\(historicalAccess\) \|\| reopenedDate/);
assert.match(page, /const submittedSnapshot = \["submitted", "finalized", "approved"\]\.includes\(selectedDateStatus\)/);
assert.match(page, /!historicalDateOpen && \(period\?\.server_read_only \?\? dayLock\?\.is_locked\)/);
assert.match(page, /readOnly && readOnlyReason && !historicalDateOpen/);
assert.match(page, /const responseText = await response\.text\(\)/, "Load Attendance must inspect the raw response before parsing JSON");
assert.match(page, /server returned a non-JSON response/, "Load Attendance must explain non-JSON API failures");

const grantMatchesScope = (grant, scope) =>
  grant.organization_id === scope.organization_id &&
  grant.site_id === scope.site_id &&
  (!grant.company_id || grant.company_id === scope.company_id) &&
  grant.from_date <= scope.date && grant.to_date >= scope.date && grant.status === "open";
const scope = { organization_id: "org-a", company_id: "company-a", site_id: "site-a", date: "2026-11-06" };
if (!grantMatchesScope({ ...scope, status: "open", company_id: "company-a", from_date: "2026-11-01", to_date: "2026-11-10" }, scope)) throw new Error("A matching active historical grant should open the date");
if (grantMatchesScope({ ...scope, status: "open", company_id: "company-b", from_date: "2026-11-01", to_date: "2026-11-10" }, scope)) throw new Error("A different-company grant must not open the date");
if (grantMatchesScope({ ...scope, status: "expired", from_date: "2026-11-01", to_date: "2026-11-10" }, scope)) throw new Error("An expired grant must not open the date");

console.log("Labour historical access roster rules: PASS");
