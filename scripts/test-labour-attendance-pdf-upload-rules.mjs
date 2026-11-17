import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const route = fs.readFileSync("app/api/labour/attendance/date-document/route.ts", "utf8");
const submit = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");

assert.match(page, /const canEditSupportingPdf = canEditAttendance/);
assert.match(page, /\["draft", "reopened"\]\.includes\(selectedDateStatus\)/);
assert.match(page, /!supportingPdfNeedsReason \|\| Boolean\(supportingPdfBackdatedReason\.trim\(\)\)/);
assert.match(page, /formData\.set\("backdated_reason", supportingPdfNeedsReason/);
assert.match(page, /Reason for older attendance date/);
assert.match(page, /server returned a non-JSON response/);

assert.match(route, /requireLabourPermission\(request, "labour_attendance", "edit"\)/);
assert.match(route, /loadLabourAttendanceDateAuthority\(access/);
assert.match(route, /dateAuthority\.submittedSnapshotLocked/);
assert.match(route, /actorCanEditAttendanceDate\(/);
assert.match(route, /reopened: dateAuthority\.reopened/);
assert.match(route, /loadLabourEditLockBlocker/);
assert.match(route, /hasActiveSiteHrAssignment/);
assert.match(route, /validateLabourOperationalCompanySite/);
assert.match(route, /storage_bucket: object\.bucket/);
assert.match(route, /audit\(access, request/);

assert.match(submit, /dateAuthority\.reopened/);
assert.match(submit, /historical attendance date must be reopened or explicitly opened/);

const canEditPdf = ({ permission, loaded, status, readOnly, historical, reopened, needsReason, reason }) =>
  permission && loaded && !readOnly && ["draft", "reopened"].includes(status)
  && (!needsReason || Boolean(reason?.trim()));
assert.equal(canEditPdf({ permission: true, loaded: true, status: "draft", readOnly: false, historical: false, reopened: false, needsReason: false, reason: "" }), true);
assert.equal(canEditPdf({ permission: true, loaded: true, status: "draft", readOnly: false, historical: false, reopened: false, needsReason: true, reason: "" }), false);
assert.equal(canEditPdf({ permission: true, loaded: true, status: "draft", readOnly: false, historical: false, reopened: false, needsReason: true, reason: "Routine late entry" }), true);
assert.equal(canEditPdf({ permission: true, loaded: true, status: "reopened", readOnly: false, historical: false, reopened: true, needsReason: false, reason: "" }), true);
assert.equal(canEditPdf({ permission: true, loaded: true, status: "submitted", readOnly: true, historical: true, reopened: false, needsReason: false, reason: "" }), false);
assert.equal(canEditPdf({ permission: false, loaded: true, status: "draft", readOnly: false, historical: true, reopened: false, needsReason: false, reason: "" }), false);

console.log("Labour Attendance PDF upload authorization rules passed");
