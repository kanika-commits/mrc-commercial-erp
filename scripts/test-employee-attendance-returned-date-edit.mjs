import fs from "node:fs";

const shared = fs.readFileSync("app/api/hr/attendance/_shared.ts", "utf8");
const dailyRoute = fs.readFileSync("app/api/hr/attendance/daily/route.ts", "utf8");
const dailyPage = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");
const submitRoute = fs.readFileSync("app/api/hr/attendance/periods/[id]/submit/route.ts", "utf8");

if (!shared.includes("isExactReopenedDailySubmission")) throw new Error("Missing exact reopened-submission validator");
if (!shared.includes('String(submission.status || "").toLowerCase() === "reopened"')) throw new Error("Reopened status must be normalized");
for (const [field, value] of [["organization_id", "organizationId"], ["company_id", "companyId"], ["site_id", "siteId"], ["attendance_date", "attendanceDate"]]) {
  if (!shared.includes("submission." + field + " === values." + value)) throw new Error("Reopened validator must check " + field);
}

const loadBeforeGuard = (source, guard) => {
  const loadIndex = source.indexOf("const [historicalAccess, dailySubmission] = await Promise.all");
  const guardIndex = source.indexOf(guard);
  if (loadIndex < 0 || guardIndex < 0 || loadIndex > guardIndex) throw new Error(guard + " must follow the exact submission lookup");
};
loadBeforeGuard(dailyRoute.slice(0, dailyRoute.indexOf("export async function PUT")), "assertDateSelectable(auth, attendanceDate, Boolean(historicalAccess), returnedDate)");
loadBeforeGuard(dailyRoute.slice(dailyRoute.indexOf("export async function PUT")), "assertDateEditAllowed(auth, attendanceDate, payload.backdated_reason, Boolean(historicalAccess), returnedDate)");
if (!dailyRoute.includes('if (dailySubmission && !["draft", "reopened"].includes(String(dailySubmission.status || "").toLowerCase()))')) {
  throw new Error("Daily save must retain its submitted/approved/cancelled status guard");
}
if (!submitRoute.includes('if (dailySubmission && !["draft", "reopened"].includes(String(dailySubmission.status || "").toLowerCase()))')) {
  throw new Error("Resubmit route must retain its exact status guard");
}
if (!dailyPage.includes("contextHasReturnedSubmission")) throw new Error("Daily page must recognize the exact returned date");
if (!dailyPage.includes("hasReturnedSubmission")) throw new Error("Daily page must exempt only the returned date from the old-date message");
if (!dailyPage.includes('String(context.dailySubmission?.status || "").toLowerCase()')) throw new Error("Daily page must normalize status casing before allowing edits");
if (!dailyPage.includes("const explicitlyOpen = Boolean(context.historicalAccess) || returned;")) throw new Error("Daily page must allow an authorized historical or returned date to bypass the ordinary day lock");
if (!dailyPage.includes("if (context.dayLock && !explicitlyOpen) return false;")) throw new Error("Daily page must retain ordinary day-lock protection outside an authorized open scope");

const scope = {
  organizationId: "org-a",
  companyId: "company-a",
  siteId: "site-a",
  attendanceDate: "2026-10-31",
};
const reopenedFixture = {
  organization_id: scope.organizationId,
  company_id: scope.companyId,
  site_id: scope.siteId,
  attendance_date: scope.attendanceDate,
};
const isExactReopened = (submission, values) => Boolean(
  submission &&
  String(submission.status || "").toLowerCase() === "reopened" &&
  submission.organization_id === values.organizationId &&
  submission.company_id === values.companyId &&
  submission.site_id === values.siteId &&
  submission.attendance_date === values.attendanceDate,
);

if (!isExactReopened({ ...reopenedFixture, status: "reopened" }, scope)) throw new Error("An exact old reopened date should be editable");
for (const status of ["draft", "submitted", "approved", "cancelled"]) {
  if (isExactReopened({ ...reopenedFixture, status }, scope)) throw new Error(status + " must not receive the returned-date exception");
}
if (isExactReopened({ ...reopenedFixture, status: "REOPENED", site_id: "other-site" }, scope)) throw new Error("A different site must not receive the returned-date exception");
if (isExactReopened({ ...reopenedFixture, status: "reopened", attendance_date: "2026-10-30" }, scope)) throw new Error("A different date must not receive the returned-date exception");
if (isExactReopened({ ...reopenedFixture, status: "reopened", organization_id: "other-org" }, scope)) throw new Error("A different organization must not receive the returned-date exception");

const canEditRow = ({ canEdit, future, oldDate, adminRecovery, historicalAccess, returned, dayLock, status }) => {
  if (!canEdit || future || (oldDate && !adminRecovery && !historicalAccess && !returned)) return false;
  if (dayLock && !(historicalAccess || returned)) return false;
  return !["submitted", "approved", "cancelled"].includes(String(status || "").toLowerCase());
};
if (!canEditRow({ canEdit: true, oldDate: true, historicalAccess: true, dayLock: true, status: "draft" })) throw new Error("Authorized historical draft must remain editable when the ordinary day lock is active");
if (!canEditRow({ canEdit: true, oldDate: true, returned: true, dayLock: true, status: "reopened" })) throw new Error("Exact returned date must remain editable when the ordinary day lock is active");
for (const status of ["submitted", "approved", "cancelled"]) {
  if (canEditRow({ canEdit: true, oldDate: true, historicalAccess: true, dayLock: true, status })) throw new Error(status + " must remain protected from UI editing");
}
if (canEditRow({ canEdit: true, oldDate: true, historicalAccess: false, returned: false, dayLock: true, status: "draft" })) throw new Error("An ordinary locked old date must remain read-only");
if (canEditRow({ canEdit: false, oldDate: true, historicalAccess: true, dayLock: true, status: "draft" })) throw new Error("Historical access must not bypass the edit permission");

console.log("PASS: exact reopened daily dates are eligible for correction; ordinary old statuses and mismatched scopes remain blocked.");
