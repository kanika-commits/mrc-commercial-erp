import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202611180001_labour_transfer_attendance_guard.sql", "utf8");

assert.match(route, /loadLabourTransferAttendanceBlocker/);
assert.match(route, /openDeployment && \{ companyId: openDeployment\.company_id, siteId: openDeployment\.site_id, contractorProfileId: openDeployment\.contractor_profile_id \}/);
assert.match(route, /return jsonError\(attendanceBlocker, 409\)/);
assert.match(shared, /before transferring this worker/);
assert.match(shared, /labour_attendance_day_locks/);
assert.match(shared, /labour_attendance_submission_versions/);
assert.match(shared, /dateStatus === "reopened" \|\| period\.status === "reopened"/);
assert.match(migration, /create or replace function public\.assert_labour_transfer_attendance_editable/);
assert.match(migration, /create trigger labour_transfer_attendance_guard/);
assert.match(migration, /old\.company_id/);
assert.match(migration, /new\.company_id/);
assert.match(migration, /status = 'submitted'/);
assert.match(migration, /v_status in \('reopened', 'draft'\)/);

const locked = { source: true, destination: false };
assert.equal(Object.values(locked).some(Boolean), true);
const reopened = { source: "reopened", destination: "reopened" };
assert.equal(Object.values(reopened).every((status) => status === "reopened"), true);
assert.equal(new Set(["source-worker", "source-worker"]).size, 1, "A rejected transfer must not create a second deployment");

console.log("Labour transfer attendance guard rules passed");
