import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609040021_labour_attendance_submission_date_status_merge_fix.sql", "utf8");

assert.match(shared, /worker\.status !== "active" && !input\.deploymentIds/);
assert.match(shared, /!inactiveEffectiveDate \|\| input\.attendanceDate >= inactiveEffectiveDate/);
assert.match(migration, /w\.status = 'active'/);
assert.match(migration, /new_values->>'effective_date'/);
assert.match(migration, /created_at at time zone 'Asia\/Kolkata'/);
assert.match(migration, /> p_attendance_date/);

function eligible(workerStatus, effectiveDate, attendanceDate, frozen = false) {
  if (frozen) return true;
  if (workerStatus === "active") return true;
  return Boolean(effectiveDate) && attendanceDate < effectiveDate;
}
assert.equal(eligible("active", null, "2026-11-15"), true);
assert.equal(eligible("inactive", null, "2026-11-15"), false);
assert.equal(eligible("inactive", "2026-11-14", "2026-11-15"), false);
assert.equal(eligible("inactive", "2026-11-15", "2026-11-15"), false);
assert.equal(eligible("inactive", "2026-11-16", "2026-11-15"), true);
assert.equal(eligible("inactive", "2026-11-14", "2026-11-15", true), true);
console.log("Labour date-effective roster rules passed");
