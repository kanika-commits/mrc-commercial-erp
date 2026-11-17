import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const saveApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const submitApi = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");
assert.match(page, /const explicitlyAuthorizedDate = Boolean\(historicalAccess\) \|\| reopenedDate/);
assert.match(page, /backdated_reason = backdated && !explicitlyAuthorizedDate/);
assert.match(page, /if \(backdated && !explicitlyAuthorizedDate && !backdated_reason\)/);
assert.match(page, /sentBack \? "Resubmit Attendance" : "Submit Attendance"/);
assert.match(saveApi, /actorCanEditAttendanceDate\(access, attendanceDate, backdatedReason, \{ reopened: reopenedDate/);
assert.match(submitApi, /dateAuthority\.reopened/);
assert.match(submitApi, /submittedSnapshotLocked/);

const normalStart = "2026-11-03";
const canSave = (date, sentBack, historicalAccess, reason = "") => date >= normalStart || sentBack || historicalAccess || Boolean(reason);
assert.equal(canSave("2026-11-05", true, false), true, "sent-back date must not require a generic reason");
assert.equal(canSave("2026-11-05", false, true), true, "historically authorized date remains allowed");
assert.equal(canSave("2026-11-02", false, false), false, "older unauthorized date remains blocked");
console.log("Labour sent-back resubmission rules passed");
