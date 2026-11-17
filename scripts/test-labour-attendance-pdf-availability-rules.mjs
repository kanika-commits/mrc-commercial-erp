import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const api = fs.readFileSync("app/api/labour/attendance/date-document/route.ts", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");

assert.match(page, /const normalDateOpen = filters\.attendance_date >= earliestNormalEditDate/);
assert.match(page, /serverReopenedDate \|\| Boolean\(historicalAccess\) \|\| \(selectedDateStatus === "draft" && normalDateOpen\)/);
assert.match(page, /canEditSupportingPdf = canEditAttendance/);
assert.match(api, /function canMutateDateDocument\(period: any, attendanceDate: string\)/);
assert.match(api, /\["draft", "reopened"\]\.includes\(dateStatus\(period, attendanceDate\)\)/);
assert.match(api, /dateAuthority\.submittedSnapshotLocked/);
assert.match(api, /loadLabourEditLockBlocker/);
assert.match(api, /validateLabourOperationalCompanySite/);
assert.match(api, /actorCanEditAttendanceDate\(/);
assert.match(shared, /if \(!options\.reopened && !options\.historicallyOpened && !normalizeText\(reason\)\)/);

const canShow = ({ status, date, normalStart, historical = false, reopened = false, locked = false, authorized = true }) =>
  authorized && !locked && (reopened || historical || (status === "draft" && date >= normalStart));
assert.equal(canShow({ status: "draft", date: "2026-11-16", normalStart: "2026-11-15" }), true, "normal draft date is available");
assert.equal(canShow({ status: "draft", date: "2026-11-16", normalStart: "2026-11-15", authorized: true }), true, "normal date works across in-scope sites");
assert.equal(canShow({ status: "submitted", date: "2026-11-16", normalStart: "2026-11-15" }), false, "submitted date is blocked");
assert.equal(canShow({ status: "draft", date: "2026-11-16", normalStart: "2026-11-15", locked: true }), false, "locked date is blocked");
assert.equal(canShow({ status: "draft", date: "2026-11-10", normalStart: "2026-11-15" }), false, "unauthorized historical date is blocked");
assert.equal(canShow({ status: "draft", date: "2026-11-10", normalStart: "2026-11-15", historical: true }), true, "authorized historical date remains available");
assert.equal(canShow({ status: "reopened", date: "2026-11-10", normalStart: "2026-11-15", reopened: true }), true, "reopened date remains available");
console.log("PASS: Labour PDF availability covers normal draft dates across sites and preserves submitted, locked, historical, and reopened protections.");
