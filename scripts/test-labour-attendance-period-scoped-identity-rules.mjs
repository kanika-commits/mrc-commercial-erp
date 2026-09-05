import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609050002_labour_attendance_period_scoped_identity.sql", "utf8");
const standardPage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const standardApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const engineerApi = fs.readFileSync("app/api/labour/engineer-daily/route.ts", "utf8");
const importExecuteApi = fs.readFileSync("app/api/labour/attendance-import/execute/route.ts", "utf8");
const importValidateApi = fs.readFileSync("app/api/labour/attendance-import/validate/route.ts", "utf8");
const dashboardApi = fs.readFileSync("app/api/labour/dashboard/route.ts", "utf8");
const workGroupsApi = fs.readFileSync("app/api/labour/work-groups/route.ts", "utf8");
const wageCalculateApi = fs.readFileSync("app/api/labour/wages/[id]/calculate/route.ts", "utf8");
const monthlyApi = fs.readFileSync("app/api/labour/attendance/monthly/route.ts", "utf8");
const snapshotMigration = fs.readFileSync("supabase/migrations/202609040021_labour_attendance_submission_date_status_merge_fix.sql", "utf8");

function identityKey(row) {
  return `${row.period_id}|${row.labour_worker_id}|${row.attendance_date}`;
}

const submittedPeriodARow = {
  period_id: "period-a-submitted",
  labour_worker_id: "worker-ravi",
  attendance_date: "2026-09-02",
  company_id: "other-company",
  site_id: "other-site",
};
const draftPeriodBRow = {
  period_id: "period-b-lnmiit-draft",
  labour_worker_id: "worker-ravi",
  attendance_date: "2026-09-02",
  company_id: "lnmiit-company",
  site_id: "lnmiit-site",
};

assert.equal(
  `${submittedPeriodARow.labour_worker_id}|${submittedPeriodARow.attendance_date}`,
  `${draftPeriodBRow.labour_worker_id}|${draftPeriodBRow.attendance_date}`,
  "RAVI/ANKIT regression fixture must collide under the old global worker/date identity",
);
assert.notEqual(
  identityKey(submittedPeriodARow),
  identityKey(draftPeriodBRow),
  "RAVI/ANKIT regression fixture must not collide under period-scoped identity",
);
assert.equal(
  new Set([identityKey(draftPeriodBRow), identityKey(draftPeriodBRow)]).size,
  1,
  "Same period + worker + date still has one canonical identity",
);
assert.equal(
  new Set([identityKey(submittedPeriodARow), identityKey(draftPeriodBRow)]).size,
  2,
  "Same worker/date in different legitimate periods is independently writable",
);

const monthlyPeriodARows = [submittedPeriodARow, draftPeriodBRow]
  .filter((row) => row.period_id === submittedPeriodARow.period_id)
  .map(identityKey);
const monthlyPeriodBRows = [submittedPeriodARow, draftPeriodBRow]
  .filter((row) => row.period_id === draftPeriodBRow.period_id)
  .map(identityKey);
assert.deepEqual(monthlyPeriodARows, [identityKey(submittedPeriodARow)], "Monthly Period A view must not include Period B rows for the same worker/date");
assert.deepEqual(monthlyPeriodBRows, [identityKey(draftPeriodBRow)], "Monthly Period B view must not include Period A rows for the same worker/date");

assert.match(migration, /^begin;/m, "Identity migration must run in a transaction");
assert.match(migration, /where period_id is null[\s\S]+raise exception 'Cannot scope labour_attendance identity: % rows have NULL period_id\.'/i, "Migration must precheck NULL period_id");
assert.match(migration, /where company_id is null[\s\S]+raise exception 'Cannot scope labour_attendance identity: % rows have NULL company_id\.'/i, "Migration must precheck NULL company_id");
assert.match(migration, /where site_id is null[\s\S]+raise exception 'Cannot scope labour_attendance identity: % rows have NULL site_id\.'/i, "Migration must precheck NULL site_id");
assert.match(migration, /p\.organization_id is distinct from a\.organization_id[\s\S]+p\.company_id is distinct from a\.company_id[\s\S]+p\.site_id is distinct from a\.site_id/i, "Migration must precheck attendance row period context");
assert.match(migration, /group by period_id, labour_worker_id, attendance_date[\s\S]+having count\(\*\) > 1/i, "Migration must precheck proposed-key duplicates");
assert.match(migration, /drop constraint labour_attendance_labour_worker_id_attendance_date_key/i, "Migration must remove obsolete global worker/date uniqueness");
assert.match(migration, /constraint labour_attendance_period_worker_date_key[\s\S]+unique \(period_id, labour_worker_id, attendance_date\)/i, "Migration must create the canonical period-scoped unique constraint");
assert.doesNotMatch(migration, /\bupdate\s+public\.labour_attendance\b|\bdelete\s+from\s+public\.labour_attendance\b/i, "Identity migration must not rewrite or delete attendance values");
assert.doesNotMatch(migration, /labour_attendance_submission_versions|labour_attendance_submission_version_rows/i, "Identity migration must not mutate immutable snapshots");
assert.doesNotMatch(migration, /drop trigger|disable trigger|row level security|alter table public\.labour_attendance disable/i, "Identity migration must preserve submitted trigger and RLS behavior");

assert.match(snapshotMigration, /create trigger labour_attendance_submitted_date_mutation_guard[\s\S]+before insert or update or delete on public\.labour_attendance/i, "Submitted Period A rows remain protected by the existing trigger");
assert.match(snapshotMigration, /perform public\.assert_labour_attendance_date_mutable\(old\.period_id, old\.attendance_date\)/, "Updates still protect old submitted period rows");
assert.match(snapshotMigration, /perform public\.assert_labour_attendance_date_mutable\(new\.period_id, new\.attendance_date\)/, "Updates still protect new submitted period rows");
assert.match(snapshotMigration, /where period_id = p_period_id and attendance_date = p_attendance_date/i, "Snapshot capture must remain period/date scoped");

assert.match(standardApi, /\.upsert\(rows, \{ onConflict: "period_id,labour_worker_id,attendance_date" \}\)/, "Standard Attendance POST must use period-scoped identity");
assert.match(standardApi, /periodId: period\.id/, "Standard Attendance POST must put the server-resolved period on each row");
assert.match(standardPage, /contractor_profile_id: filters\.contractor_profile_id \|\| null/, "All Contractors must remain a filter, not part of identity");

assert.match(engineerApi, /\.in\("period_id", periodIds\)[\s\S]+\.eq\("attendance_date", context\.workDate\)[\s\S]+\.in\("labour_worker_id", workerIds\)/, "Engineer Daily existing-row lookup must be period scoped");
assert.match(engineerApi, /\.upsert\(upserts, \{ onConflict: "period_id,labour_worker_id,attendance_date" \}\)/, "Engineer Daily upsert must use period-scoped identity");

assert.match(importExecuteApi, /\.eq\("period_id", period\.id\)[\s\S]+\.eq\("labour_worker_id", row\.matched_labour_worker_id\)[\s\S]+\.eq\("attendance_date", row\.attendance_date\)/, "Attendance Import execution must find existing rows in the resolved period only");
assert.match(importExecuteApi, /\.upsert\(attendancePayload, \{ onConflict: "period_id,labour_worker_id,attendance_date" \}\)/, "Attendance Import execution must use period-scoped identity");
assert.match(importValidateApi, /periodByMonth[\s\S]+existingKeys[\s\S]+\$\{row\.period_id\}\|\$\{row\.labour_worker_id\}\|\$\{row\.attendance_date\}/, "Attendance Import validation must warn only for existing rows in the scoped period");

assert.match(dashboardApi, /\.eq\("organization_id", organizationId\)[\s\S]+\.eq\("company_id", companyId\)[\s\S]+\.eq\("site_id", siteId\)[\s\S]+\.eq\("attendance_date", date\)[\s\S]+\.in\("labour_worker_id", workerIds\)/, "Dashboard attendance reader must be scoped before worker/date lookup");
assert.match(workGroupsApi, /\.eq\("organization_id", organizationId\)[\s\S]+\.eq\("company_id", companyId\)[\s\S]+\.eq\("site_id", siteId\)[\s\S]+\.eq\("attendance_date", workDate\)[\s\S]+\.in\("labour_worker_id", memberWorkerIds\)/, "Work Groups attendance reader must be scoped before worker/date lookup");
assert.match(wageCalculateApi, /\.eq\("period_id", wagePeriod\.attendance_period_id\)[\s\S]+\.eq\("organization_id", wagePeriod\.organization_id\)[\s\S]+\.eq\("company_id", wagePeriod\.company_id\)[\s\S]+\.eq\("site_id", wagePeriod\.site_id\)/, "Wage calculation must read rows from the canonical attendance period");
assert.match(monthlyApi, /async function resolveMonthlyAttendancePeriod[\s\S]+\.eq\("organization_id", input\.organizationId\)[\s\S]+\.eq\("company_id", input\.companyId\)[\s\S]+\.eq\("site_id", input\.siteId\)[\s\S]+\.eq\("period_month", input\.periodMonth\)[\s\S]+\.is\("contractor_profile_id", null\)/, "Monthly attendance must resolve the authoritative Company/Site/month period");
assert.match(monthlyApi, /Multiple labour attendance periods exist for the selected Company\/Site\/month/, "Monthly attendance must stop instead of picking an arbitrary duplicate period");
assert.match(monthlyApi, /\.select\("period_id, labour_worker_id, attendance_date, status, overtime_minutes"\)[\s\S]+\.eq\("period_id", period\.id\)[\s\S]+\.gte\("attendance_date", periodMonth\)[\s\S]+\.lte\("attendance_date", monthEnd\)[\s\S]+\.in\("labour_worker_id", workerIds\)/, "Monthly attendance reader must query only rows from the resolved period");
assert.match(monthlyApi, /attendanceByScopedKey[\s\S]+\$\{row\.period_id\}:\$\{row\.labour_worker_id\}:\$\{row\.attendance_date\}/, "Monthly attendance map key must include period id");
assert.match(monthlyApi, /attendanceByScopedKey\.get\(`\$\{period\.id\}:\$\{workerId\}:\$\{date\}`\)/, "Monthly attendance lookup must use the resolved period id");
assert.doesNotMatch(monthlyApi, /attendanceByWorkerDate|`\$\{row\.labour_worker_id\}:\$\{row\.attendance_date\}`|get\(`\$\{workerId\}:\$\{date\}`\)/, "Monthly attendance must not retain worker/date-only map identity");

console.log("Labour attendance period-scoped identity regression rules passed.");
