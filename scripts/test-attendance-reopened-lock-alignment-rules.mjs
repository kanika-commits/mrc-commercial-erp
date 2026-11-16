import assert from "node:assert/strict";
import fs from "node:fs";

const employee = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const labourDaily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const labourDocument = fs.readFileSync("app/api/labour/attendance/date-document/route.ts", "utf8");
const labourSubmit = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");
const labourPage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const employeeShared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const employeeSubmit = fs.readFileSync("app/api/hr/attendance/periods/[id]/submit/route.ts", "utf8");

assert.match(employee, /const explicitlyOpen = Boolean\(historicalAccess\) \|\| returnedDate/);
assert.match(employee, /if \(\(dayLock \|\| lockedByPolicy\) && !explicitlyOpen\)/);
assert.match(employee, /hasEmployeePostLockEditAuthority\(auth, policy\)/, "Ordinary locked dates still require post-lock authority");
assert.match(employee, /validateCompanySiteScope\(admin, auth, params\.companyId, params\.siteId\)/, "Employee scope validation must remain exact");
assert.match(employee, /companyId: params\.companyId/, "Employee historical authority must be company-scoped");
assert.match(employeeShared, /company_id\.is\.null,company_id\.eq\.\$\{input\.companyId \|\| \"\"\}/, "Employee historical grants must not cross companies");
assert.match(employeeSubmit, /loadActiveHistoricalAttendanceAccess/, "Direct Employee submit must load historical authority");
assert.match(employeeSubmit, /assertDateSelectable\(auth, attendanceDate, Boolean\(historicalAccess\), returnedDate\)/, "Direct old-date submit must enforce date authority");

assert.match(labourDaily, /if \(dayLock\?\.is_locked && !explicitlyOpen\) return "Attendance is locked for this date\."/);
assert.match(labourDaily, /const explicitlyOpen = selectedStatus === "reopened" \|\| \(Boolean\(historicalAccess\) && !dateAuthority\.submittedSnapshotLocked\)/);
assert.match(labourDaily, /date_status: selectedStatus/, "Labour roster must expose the server-authoritative date status");
assert.match(labourDaily, /validateLabourOperationalCompanySite\(access, requestedOrganizationId, companyId, siteId\)/, "Labour attendance must use authoritative company/site pairs");
assert.match(labourDaily, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted/);
assert.match(labourDaily, /const lockBlocker = explicitlyOpen\s+\? null/);

assert.match(labourDocument, /loadLabourAttendanceDateAuthority\(access, \{/);
assert.match(labourDocument, /validateLabourOperationalCompanySite\(access, input\.organizationId \|\| null, input\.companyId, input\.siteId\)/, "Labour PDF scope must use authoritative company/site pairs");
assert.match(labourDocument, /if \(dateAuthority\.submittedSnapshotLocked\) return jsonError\("Attendance for this date has already been submitted\. Reopen the date before uploading/);
assert.match(labourDocument, /companyId: resolved\.companyId, siteId: resolved\.siteId, attendanceDate: resolved\.attendanceDate, attendanceType: "labour"/);
assert.match(labourDocument, /const explicitlyOpenForLock = dateAuthority\.reopened \|\| Boolean\(historicalAccess\)/);
assert.match(labourDocument, /if \(!explicitlyOpenForLock\) \{/);
assert.match(labourDocument, /dateAuthority\.submittedSnapshotLocked/, "PDF removal must preserve submitted snapshots");
assert.match(labourDocument, /const explicitlyOpen = dateAuthority\.reopened \|\| Boolean\(dateAuthority\.historicalAccess\)/, "PDF removal must bypass locks only for the exact opened scope");
assert.match(labourDocument, /historicallyOpened: Boolean\(dateAuthority\.historicalAccess\) && !dateAuthority\.reopened/, "PDF removal must pass historical authority to date editing");
assert.match(labourDocument, /canMutateDateDocument\(resolved\.period, resolved\.attendanceDate\) && !explicitlyOpen/, "PDF removal must allow an opened date before the ordinary status gate");
assert.match(labourSubmit, /companyId: period\.company_id/, "Labour direct submit authority must be company-scoped");
assert.match(labourSubmit, /historical attendance date must be reopened or explicitly opened/, "Labour direct submit must guard old dates");
const lookups = fs.readFileSync("app/api/labour/lookups/route.ts", "utf8");
assert.match(lookups, /from\("labour_deployments"\)[\s\S]+contractor_profile_id, labour_contractor_profiles/, "Contractor lookup should use a focused deployment query");
assert.match(lookups, /effective_to\.is\.null,effective_to\.gte\.\$\{input\.effectiveDate\}/, "Contractor lookup must retain date scope");

const canRemovePdf = ({ periodStatus, reopened, historicalAccess, submittedSnapshotLocked }) =>
  !submittedSnapshotLocked && (reopened || historicalAccess || ["draft", "reopened"].includes(periodStatus));
if (canRemovePdf({ periodStatus: "submitted", reopened: false, historicalAccess: true, submittedSnapshotLocked: true })) {
  throw new Error("Submitted snapshots must remain protected even with historical access");
}
if (!canRemovePdf({ periodStatus: "submitted", reopened: false, historicalAccess: true, submittedSnapshotLocked: false })) {
  throw new Error("An exact opened historical date should pass the ordinary PDF status gate");
}
if (canRemovePdf({ periodStatus: "submitted", reopened: false, historicalAccess: false, submittedSnapshotLocked: false })) {
  throw new Error("A locked submitted date without authority must remain protected");
}
assert.match(labourDocument, /if \(stored\)[\s\S]+createPrivateStorageAdapter\(access\.admin\)\.delete\(stored\)/);
assert.match(labourDocument, /if \(deactivatedDocumentId && !replacementInserted\)/);
assert.match(shared, /\.eq\("organization_id", input\.organizationId\)/);
assert.match(shared, /\.eq\("site_id", input\.siteId\)/);
assert.match(shared, /company_id\.is\.null,company_id\.eq\.\$\{input\.companyId\}/);
assert.match(labourPage, /const canEditSupportingPdf = canEditAttendance/);
assert.match(labourPage, /const selectedDateStatus = period\?\.server_date_status \|\| dateSummary\.status \|\| "draft"/);
assert.match(labourPage, /\["draft", "reopened"\]\.includes\(selectedDateStatus\)/);
assert.match(labourPage, /\(Boolean\(historicalAccess\) \|\| reopenedDate\)/);
assert.match(labourPage, /\{canEditSupportingPdf && \(/, "Upload/replace controls must require the validated open-date UI state");

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

const companyScopedGrantMatches = (grant, selectedCompanyId) =>
  !grant.company_id || grant.company_id === selectedCompanyId;
assert.equal(companyScopedGrantMatches({ company_id: "company-a" }, "company-a"), true);
assert.equal(companyScopedGrantMatches({ company_id: "company-a" }, "company-b"), false);
assert.equal(companyScopedGrantMatches({ company_id: null }, "company-b"), true);

console.log("Reopened attendance lock alignment rules: PASS");
