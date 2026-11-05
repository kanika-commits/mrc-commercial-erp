import assert from "node:assert/strict";
import { getAttendanceSentBackDetails } from "../lib/hr/attendanceSentBack.ts";

const daily = getAttendanceSentBackDetails({
  status: "reopened",
  reopen_reason: "Correct the late entry",
  reopened_by_name: "Reviewer",
  reopened_at: "2026-11-05T08:00:00.000Z",
  submitted_at: "2026-11-04T08:00:00.000Z",
}, {});
assert.deepEqual(daily, {
  reason: "Correct the late entry",
  sender: "Reviewer",
  sentBackAt: "2026-11-05T08:00:00.000Z",
  previouslySubmittedAt: "2026-11-04T08:00:00.000Z",
});

const legacy = getAttendanceSentBackDetails({}, {
  send_back_reason: "Legacy monthly correction",
  reopened_by_email: "reviewer@example.test",
  reopened_at: "2026-11-03T08:00:00.000Z",
  submitted_at: "2026-11-02T08:00:00.000Z",
});
assert.equal(legacy.reason, "Legacy monthly correction");
assert.equal(legacy.sender, "reviewer@example.test");
assert.equal(legacy.sentBackAt, "2026-11-03T08:00:00.000Z");
assert.equal(legacy.previouslySubmittedAt, "2026-11-02T08:00:00.000Z");
console.log("PASS: date-level Send Back banner metadata and legacy monthly fallback.");
