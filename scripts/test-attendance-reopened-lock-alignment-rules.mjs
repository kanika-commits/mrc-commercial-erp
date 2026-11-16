import assert from "node:assert/strict";
import fs from "node:fs";

const employee = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const labourDaily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const labourDocument = fs.readFileSync("app/api/labour/attendance/date-document/route.ts", "utf8");
const labourPage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");

assert.match(employee, /const explicitlyOpen = Boolean\(historicalAccess\) \|\| returnedDate/);
assert.match(employee, /if \(\(dayLock \|\| lockedByPolicy\) && !explicitlyOpen\)/);
assert.match(employee, /hasEmployeePostLockEditAuthority\(auth, policy\)/);
assert.match(employee, /validateCompanySiteScope\(admin, auth, params\.companyId, params\.siteId\)/);

assert.match(labourDaily, /if \(dayLock\?\.is_locked && !explicitlyOpen\) return "Attendance is locked for this date\."/);
assert.match(labourDaily, /const explicitlyOpen = selectedStatus === "reopened" \|\| \(Boolean\(historicalAccess\) && !dateAuthority\.submittedSnapshotLocked\)/);
assert.match(labourDaily, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted/);
assert.match(labourDaily, /const lockBlocker = explicitlyOpen\s+\? null/);

assert.match(labourDocument, /loadLabourAttendanceDateAuthority\(access, \{/);
assert.match(labourDocument, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted\. Reopen the date before uploading/);
assert.match(labourDocument, /companyId: resolved\.companyId, siteId: resolved\.siteId, attendanceDate: resolved\.attendanceDate, attendanceType: "labour"/);
assert.match(labourDocument, /const explicitlyOpen = dateAuthority\.reopened \|\| Boolean\(historicalAccess\)/);
assert.match(labourDocument, /if \(!explicitlyOpen\) \{/);
assert.match(labourDocument, /if \(stored\)[\s\S]+createPrivateStorageAdapter\(access\.admin\)\.delete\(stored\)/);
assert.match(labourDocument, /if \(deactivatedDocumentId && !replacementInserted\)/);

assert.match(labourPage, /const canEditSupportingPdf = canEditAttendance/);
assert.match(labourPage, /\["draft", "reopened"\]\.includes\(selectedDateStatus\)/);
assert.match(labourPage, /\(Boolean\(historicalAccess\) \|\| reopenedDate\)/);
assert.match(labourPage, /\{canEditSupportingPdf && \(/);

assert.match(shared, /\.eq\("organization_id", input\.organizationId\)/);
assert.match(shared, /\.eq\("site_id", input\.siteId\)/);
assert.match(shared, /company_id\.is\.null,company_id\.eq\.\$\{input\.companyId\}/);

const exactScope = (row, scope) => Boolean(
  row.organization_id === scope.organization_id &&
  row.company_id === scope.company_id &&
  row.site_id === scope.site_id &&
  row.attendance_date === scope.attendance_date,
);
const scope = { organization_id: "org-a", company_id: "company-a", site_id: "site-a", attendance_date: "2026-11-07" };
assert.equal(exactScope(scope, scope), true);
assert.equal(exactScope({ ...scope, company_id: "company-b" }, scope), false);
assert.equal(exactScope({ ...scope, site_id: "site-b" }, scope), false);
assert.equal(exactScope({ ...scope, attendance_date: "2026-11-06" }, scope), false);

console.log("Reopened attendance lock alignment rules: PASS");
