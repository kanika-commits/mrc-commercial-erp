import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609020010_labour_attendance_submitted_date_lock_guard.sql", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const dailyApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const submitApi = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");
const approvalApi = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");
const finalization = fs.readFileSync("supabase/migrations/202608290002_labour_attendance_finalization_snapshot_guard.sql", "utf8");
const snapshots = fs.readFileSync("supabase/migrations/202608140001_labour_attendance_submission_snapshots.sql", "utf8");
const reopenRoute = fs.readFileSync("app/api/labour/attendance/periods/[id]/reopen/route.ts", "utf8");

assert.match(shared, /loadLabourAttendanceDateAuthority/, "Shared helper must compute authoritative date state");
assert.match(shared, /\.from\("labour_attendance_submission_versions"\)[\s\S]+\.eq\("status", "submitted"\)/, "Authoritative state must read submitted snapshots");
assert.match(shared, /latestSubmitted && !reopened[\s\S]+\? "submitted"/, "Missing stale summary must fall back to submitted when a submitted snapshot exists");
assert.match(shared, /submittedSnapshotLocked: Boolean\(latestSubmitted && !reopened\)/, "Historical access must not bypass a submitted snapshot lock");
assert.match(shared, /summaryStatus === "reopened" \|\| input\.period\?\.status === "reopened"/, "Shared helper must allow both date-level and period-level reopen authority");
assert.doesNotMatch(shared, /summaryStatus === "reopened" \|\| input\.period\?\.status === "draft"/, "Draft period status must not unlock a submitted snapshot");

assert.match(dailyApi, /loadLabourAttendanceDateAuthority/, "Daily attendance API must use authoritative snapshot-backed state");
assert.match(dailyApi, /submittedSnapshotLocked[\s\S]+Attendance for this date has already been submitted\. Reopen the date before making changes\./, "Save must reject submitted dates unless reopened");
assert.match(dailyApi, /const selectedStatus = dateAuthority\.status/, "Daily read/save status must not rely only on period summary");
assert.match(dailyApi, /loadFrozenAttendanceDeploymentIds\(access, period, attendanceDate, dateStatusForPopulation\)/, "Submitted/finalized dates still hydrate frozen deployment population");
assert.match(dailyApi, /existingPeriod\?\.summary\?\.date_statuses\?\.\[attendanceDate\]\?\.status === "reopened" \|\| existingPeriod\?\.status === "reopened"/, "Daily save must preserve existing period reopen/correction edit access");

assert.match(submitApi, /loadLabourAttendanceDateAuthority/, "Submit endpoint must use authoritative snapshot-backed state");
assert.match(submitApi, /submittedSnapshotLocked[\s\S]+Attendance for this date has already been submitted\. Reopen the date before making changes\./, "Submit endpoint must reject duplicate submitted dates before RPC");
assert.match(submitApi, /create_labour_attendance_submission_snapshot/, "Draft dates still submit through the existing snapshot RPC");

assert.match(migration, /create or replace function public\.create_labour_attendance_submission_snapshot/, "Forward migration must replace the snapshot RPC");
assert.match(migration, /from public\.labour_attendance_periods where id = p_period_id for update/, "Snapshot RPC must serialize same-period submit attempts");
assert.match(migration, /v_latest_submitted_id is not null[\s\S]+Attendance for this date has already been submitted\. Reopen the date before making changes\./, "Snapshot RPC must reject version N+1 without reopen");
assert.match(migration, /v_status not in \('draft', 'reopened'\)/, "Draft and reopened submission paths remain the only normal submit states");
assert.match(migration, /v_status = 'reopened'[\s\S]+v_previous_version_id/, "Authorized reopen must preserve legitimate resubmission/version N+1 population");
assert.match(migration, /coalesce\(p_period\.summary->'date_statuses'->p_attendance_date::text->>'status', ''\) = 'reopened'[\s\S]+return true/, "Date-level Send Back/reopen must allow submitted attendance to become editable");
assert.match(migration, /p_period\.status = 'reopened'[\s\S]+return true/, "Existing period-level reopen/correction must allow submitted attendance to become editable");
assert.match(migration, /v_latest_submitted_id is not null and not public\.labour_attendance_date_has_reopen_authority/, "Submitted snapshots must stay locked unless an existing reopen authority is present");
assert.match(migration, /coalesce\(p_period\.summary->'date_statuses'->p_attendance_date::text->>'status', ''\) = 'reopened'/, "Missing date status must not be treated as reopened");
assert.doesNotMatch(migration, /coalesce\(p_period\.summary->'date_statuses'->p_attendance_date::text->>'status', 'reopened'\)/, "Missing date status must not make submitted attendance editable");
assert.doesNotMatch(migration, /p_period\.status\s+in\s+\([^)]*'draft'[^)]*\)[\s\S]+return true/, "Draft period status must not override a submitted snapshot lock");
assert.match(migration, /create trigger labour_attendance_submitted_date_mutation_guard/, "Live attendance row writes must be protected by a DB trigger");
assert.match(migration, /before insert or update or delete on public\.labour_attendance/, "Save protection must cover insert, update and delete");
assert.match(migration, /perform public\.assert_labour_attendance_date_mutable\(old\.period_id, old\.attendance_date\)/, "Updates must protect the old submitted date");
assert.match(migration, /perform public\.assert_labour_attendance_date_mutable\(new\.period_id, new\.attendance_date\)/, "Updates must protect the new submitted date");
assert.match(migration, /status = 'reopened'/, "Existing reopen status remains the authorized correction path");
assert.match(migration, /status'\s*,\s*'submitted'/, "Resubmission must return the date status to submitted so it locks again");
assert.doesNotMatch(migration, /attendance_historical_access/, "Historical access must not silently replace the submitted-date reopen workflow");
assert.doesNotMatch(migration, /delete from public\.labour_attendance_submission_versions|update public\.labour_attendance_submission_versions\s+set\s+provenance/i, "Migration must not mutate historical snapshot evidence");

assert.match(approvalApi, /standardSummaryWithDateStatus\(period, workDate, "reopened"/, "Daily Approval still sends dates back into reopened state");
assert.match(reopenRoute, /status:\s*"reopened"/, "Existing period reopen/correction route still uses reopened state");
assert.match(finalization, /labour_attendance_submission_versions[\s\S]+status = 'submitted'/, "Daily Approval still reads authoritative submitted snapshots before approval");
assert.doesNotMatch(finalization, /labour_attendance_submitted_date_mutation_guard|guard_labour_attendance_submitted_date_mutation|assert_labour_attendance_date_mutable/, "Approval/finalization must remain unaffected by the submitted-date mutation trigger");
assert.match(snapshots, /labour_attendance_submission_version_rows/, "Existing historical snapshot rows remain readable");

console.log("Labour submitted-date lock guard rules passed.");
