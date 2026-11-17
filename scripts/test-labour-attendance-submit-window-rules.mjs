import assert from "node:assert/strict";
import fs from "node:fs";

const submitRoute = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");
assert.match(submitRoute, /daysBefore, isoDate, todayInIst/);
assert.match(submitRoute, /const normalSubmissionStartDate = daysBefore\(todayInIst\(\), 2\)/);
assert.match(submitRoute, /attendanceDate < normalSubmissionStartDate && !dateAuthority\.reopened && !historicalAccess/);

function daysBefore(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const requestDate = "2026-11-17";
const normalStart = daysBefore(requestDate, 2);
assert.equal(normalStart, "2026-11-15");
for (const date of ["2026-11-17", "2026-11-16", "2026-11-15"]) {
  assert.equal(date < normalStart, false, `${date} is inside the normal three-day submission window`);
}
assert.equal("2026-11-14" < normalStart, true, "an older date requires reopen or historical authority");

const canSubmit = (date, reopened = false, historicalAccess = false) => date >= normalStart || reopened || historicalAccess;
assert.equal(canSubmit("2026-11-15"), true);
assert.equal(canSubmit("2026-11-14"), false);
assert.equal(canSubmit("2026-11-14", true), true);
assert.equal(canSubmit("2026-11-14", false, true), true);

console.log("Labour Attendance normal submission window: PASS");
