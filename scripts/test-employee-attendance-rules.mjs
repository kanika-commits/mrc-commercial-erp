import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PHASE1_ATTENDANCE_STATUSES,
  EMPLOYEE_STANDARD_WORKING_HOURS,
  buildAttendanceUpsertPayload,
  canEditAttendanceDate,
  canLockAttendanceDate,
  hasMonthEnded,
  isEmployeeEligibleForDate,
  summarizeAttendance,
} from "../lib/hr/attendance.ts";

const dailyPage = fs.readFileSync("app/hr/attendance/daily/page.tsx", "utf8");
const today = "2026-07-21";

assert.match(dailyPage, /Attendance Sent Back/, "Employee attendance entry must show sent-back feedback");
assert.match(dailyPage, /period\.send_back_reason/, "Employee attendance entry must display the send-back reason");
assert.match(dailyPage, /period\.reopened_by_name \|\| period\.reopened_by_email/, "Employee attendance entry must display who sent the period back");
assert.match(dailyPage, /sentBack \? "Resubmit Attendance" : "Submit Attendance"/, "Employee attendance entry must relabel submit as resubmit after send-back");

assert.deepEqual([...PHASE1_ATTENDANCE_STATUSES], ["present", "absent", "half_day"], "Phase 1 UI statuses are limited to Present, Absent and Half Day");
assert.equal(EMPLOYEE_STANDARD_WORKING_HOURS, 8, "Employee Attendance uses a fixed 8-hour standard working day");

assert.equal(canEditAttendanceDate(today, false, null, today).allowed, true, "normal user may edit today");
assert.equal(canEditAttendanceDate("2026-07-20", false, null, today).allowed, false, "normal user cannot edit yesterday");
assert.equal(canEditAttendanceDate("2026-07-22", false, null, today).allowed, false, "normal user cannot edit tomorrow");
assert.equal(canEditAttendanceDate("2026-07-20", true, null, today).allowed, false, "admin backdate requires reason");
assert.equal(canEditAttendanceDate("2026-07-20", true, "Correction", today).allowed, true, "admin backdate works with reason");
assert.equal(canEditAttendanceDate("2026-07-22", true, "Correction", today).allowed, false, "future denied for everyone");

assert.equal(canLockAttendanceDate(today, today), false, "today cannot be locked before day end");
assert.equal(canLockAttendanceDate("2026-07-20", today), true, "yesterday can be locked");

assert.equal(hasMonthEnded("2026-06-01", today), true, "prior month ended");
assert.equal(hasMonthEnded("2026-07-01", today), false, "current month not ended");

assert.equal(
  isEmployeeEligibleForDate({ date_of_joining: "2026-07-01", date_of_exit: null, status: "active" }, "2026-07-21"),
  true,
  "employee after joining is eligible",
);
assert.equal(
  isEmployeeEligibleForDate({ date_of_joining: "2026-07-22", date_of_exit: null, status: "active" }, "2026-07-21"),
  false,
  "employee before joining is excluded",
);
assert.equal(
  isEmployeeEligibleForDate({ date_of_joining: "2026-07-01", date_of_exit: "2026-07-20", status: "inactive" }, "2026-07-21"),
  false,
  "employee after exit is excluded",
);

const summary = summarizeAttendance(["present", "absent", "half_day"], 5);
assert.equal(summary.present, 1, "present total");
assert.equal(summary.absent, 1, "absent total");
assert.equal(summary.half_day, 1, "half-day total");
assert.equal(summary.missing, 2, "missing total");
assert.equal(summary.total_recorded, 3, "recorded total");

const newPayload = buildAttendanceUpsertPayload({
  existingRow: null,
  organizationId: "org-1",
  companyId: "company-1",
  siteId: "site-1",
  employeeId: "employee-1",
  periodId: "period-1",
  attendanceDate: today,
  status: "present",
  remarks: "",
  actorId: "actor-1",
  actorName: "Actor",
  actorEmail: "actor@example.com",
  now: "2026-07-21T10:00:00.000Z",
});
assert.equal(Object.hasOwn(newPayload, "id"), false, "new attendance payload omits id so DB default UUID can apply");
assert.equal(newPayload.employee_id, "employee-1", "new payload keeps employee conflict key");
assert.equal(newPayload.attendance_date, today, "new payload keeps date conflict key");

const existingPayload = buildAttendanceUpsertPayload({
  existingRow: {
    id: "attendance-1",
    created_by: "creator-1",
    created_by_name: "Creator",
    created_by_email: "creator@example.com",
  },
  organizationId: "org-1",
  companyId: "company-1",
  siteId: "site-1",
  employeeId: "employee-1",
  periodId: "period-1",
  attendanceDate: today,
  status: "absent",
  remarks: "Corrected",
  actorId: "actor-1",
  actorName: "Actor",
  actorEmail: "actor@example.com",
  now: "2026-07-21T11:00:00.000Z",
});
assert.equal(existingPayload.id, "attendance-1", "existing attendance payload preserves id");
assert.equal(existingPayload.created_by, "creator-1", "existing attendance payload preserves created actor");
assert.equal(existingPayload.updated_by, "actor-1", "existing attendance payload updates actor");

console.log("Employee attendance rule tests passed.");
