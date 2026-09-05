import assert from "node:assert/strict";
import fs from "node:fs";

const operations = fs.readFileSync("lib/labour/operations.ts", "utf8");
const attendancePage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const attendanceApi = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const labourShared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const submitApi = fs.readFileSync("app/api/labour/attendance/periods/[id]/submit/route.ts", "utf8");
const approvalApi = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609040021_labour_attendance_submission_date_status_merge_fix.sql", "utf8");

function mergeLabourAttendanceDateStatus(summary, attendanceDate, dateStatus) {
  const base = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  const existingStatuses = base.date_statuses && typeof base.date_statuses === "object" && !Array.isArray(base.date_statuses)
    ? base.date_statuses
    : {};
  const existingDateStatus = existingStatuses[attendanceDate] && typeof existingStatuses[attendanceDate] === "object" && !Array.isArray(existingStatuses[attendanceDate])
    ? existingStatuses[attendanceDate]
    : {};

  return {
    ...base,
    date_statuses: {
      ...existingStatuses,
      [attendanceDate]: {
        ...existingDateStatus,
        ...dateStatus,
      },
    },
  };
}

function rowsMatch(liveRow, snapshotRow) {
  return liveRow.first_half_present === snapshotRow.first_half_present
    && liveRow.second_half_present === snapshotRow.second_half_present
    && Number(liveRow.approved_overtime_minutes ?? liveRow.overtime_minutes ?? 0) === Number(snapshotRow.approved_overtime_minutes ?? snapshotRow.overtime_minutes ?? 0)
    && Number(liveRow.bonus_minutes ?? 0) === Number(snapshotRow.bonus_minutes ?? 0);
}

function booleanToShiftStatus(value) {
  if (value === true) return "present";
  if (value === false) return "absent";
  return null;
}

function selectedShiftButton(value) {
  return ["present", "absent"].filter((nextValue) => value === nextValue);
}

function changedRowsForSaveDraft(rows, dirtyWorkerIds) {
  return rows.filter((row) => dirtyWorkerIds.has(row.labour_worker_id));
}

function clearConfirmedSavedWorkers(dirtyWorkerIds, savedWorkerIds) {
  const next = new Set(dirtyWorkerIds);
  savedWorkerIds.forEach((workerId) => next.delete(workerId));
  return next;
}

assert.deepEqual(
  mergeLabourAttendanceDateStatus(null, "2026-09-04", { status: "submitted" }),
  { date_statuses: { "2026-09-04": { status: "submitted" } } },
  "NULL summary must create date_statuses",
);
assert.deepEqual(
  mergeLabourAttendanceDateStatus({}, "2026-09-04", { status: "submitted" }),
  { date_statuses: { "2026-09-04": { status: "submitted" } } },
  "Empty summary must create date_statuses",
);
assert.deepEqual(
  mergeLabourAttendanceDateStatus({ other: true }, "2026-09-04", { status: "submitted" }),
  { other: true, date_statuses: { "2026-09-04": { status: "submitted" } } },
  "Unrelated summary keys must survive",
);
assert.deepEqual(
  mergeLabourAttendanceDateStatus(
    { date_statuses: { "2026-09-03": { status: "submitted" } } },
    "2026-09-04",
    { status: "submitted" },
  ),
  { date_statuses: { "2026-09-03": { status: "submitted" }, "2026-09-04": { status: "submitted" } } },
  "Existing dates must survive a second date submission",
);
assert.deepEqual(
  mergeLabourAttendanceDateStatus(
    { date_statuses: { "2026-09-04": { status: "reopened", reason: "Correction" } } },
    "2026-09-04",
    { status: "submitted", submitted_by_name: "Mohit Kumar" },
  ),
  { date_statuses: { "2026-09-04": { status: "submitted", reason: "Correction", submitted_by_name: "Mohit Kumar" } } },
  "Existing date metadata must merge with the new submitted state",
);
assert.equal(
  rowsMatch(
    { first_half_present: true, second_half_present: false, overtime_minutes: 60, bonus_minutes: null },
    { first_half_present: true, second_half_present: false, overtime_minutes: 60, bonus_minutes: 0 },
  ),
  true,
  "Bonus NULL and 0 must not create a false mismatch",
);
assert.equal(booleanToShiftStatus(true), "present", "TRUE first/second half values render Present selected");
assert.equal(booleanToShiftStatus(false), "absent", "FALSE first/second half values render Absent selected");
assert.equal(booleanToShiftStatus(null), null, "NULL first/second half values must remain incomplete");
assert.equal(booleanToShiftStatus(undefined), null, "Undefined first/second half values must remain incomplete");
assert.deepEqual(selectedShiftButton(booleanToShiftStatus(null)), [], "NULL shift values must render neither Present nor Absent selected");
assert.deepEqual(selectedShiftButton(booleanToShiftStatus(undefined)), [], "Undefined shift values must render neither Present nor Absent selected");
assert.deepEqual(selectedShiftButton(booleanToShiftStatus(false)), ["absent"], "Explicit false shift values must render Absent selected");
assert.deepEqual(selectedShiftButton(booleanToShiftStatus(true)), ["present"], "Explicit true shift values must render Present selected");
const fiveBulkRows = ["w1", "w2", "w3", "w4", "w5"].map((labour_worker_id) => ({ labour_worker_id }));
assert.deepEqual(
  changedRowsForSaveDraft(fiveBulkRows, new Set(["w1", "w2", "w3", "w4", "w5"])).map((row) => row.labour_worker_id),
  ["w1", "w2", "w3", "w4", "w5"],
  "Save Draft must preserve 5+ dirty rows in one bulk request",
);
assert.deepEqual(
  [...clearConfirmedSavedWorkers(new Set(["w1", "w2", "w3", "w4", "w5"]), new Set(["w1", "w2"]))],
  ["w3", "w4", "w5"],
  "Partial confirmation must keep unconfirmed dirty rows dirty",
);
assert.deepEqual(
  [...clearConfirmedSavedWorkers(new Set(["w1", "w2", "w3", "w4", "w5"]), new Set())],
  ["w1", "w2", "w3", "w4", "w5"],
  "Failed bulk save must preserve dirty rows",
);

assert.match(operations, /export function mergeLabourAttendanceDateStatus/, "Shared operations must document/test date status merge semantics");
assert.match(operations, /export function labourAttendanceRowsMatch/, "Shared operations must normalize NULL\/0 bonus comparisons");

assert.match(migration, /202609040021|Fix Standard Labour Attendance submission date status JSON merge/, "A new forward migration must own this RPC fix");
assert.match(migration, /coalesce\(v_period\.summary, '\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object\(/, "RPC must create the date_statuses parent object");
assert.match(migration, /coalesce\(v_period\.summary->'date_statuses', '\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object/, "RPC must preserve other submitted dates");
assert.match(migration, /v_latest_submitted_id is not null and not public\.labour_attendance_date_has_reopen_authority/, "Submitted-date lock guard must remain preserved");
assert.match(migration, /Attendance for this date has already been submitted\. Reopen the date before making changes\./, "Duplicate submitted date protection must remain");
assert.match(migration, /Attendance snapshot integrity check failed/, "Snapshot integrity protection must remain");
assert.doesNotMatch(migration, /update public\.labour_attendance_submission_versions|delete from public\.labour_attendance_submission_versions/i, "Migration must not repair or mutate historical snapshots");

assert.match(attendanceApi, /async function loadSubmittedSnapshotRows/, "Daily API must have a snapshot-backed submitted-date display path");
assert.match(attendanceApi, /labour_attendance_submission_version_rows/, "Submitted display must read immutable snapshot rows");
assert.match(attendanceApi, /submittedSnapshotRows \|\| deployments\.map/, "Submitted rows must bypass current roster hydration");
assert.match(attendanceApi, /function booleanToShiftStatus\(value: unknown\) \{\s*if \(value === true\) return "present";\s*if \(value === false\) return "absent";\s*return null;\s*\}/, "Daily API must map NULL attendance halves to no selected shift");
assert.match(attendanceApi, /function summaryStatus\(first: "present" \| "absent" \| null, second: "present" \| "absent" \| null\) \{\s*if \(first === null && second === null\) return "not_deployed";\s*if \(first === null \|\| second === null\) return "half_day";/, "Draft API saves must not write unsupported incomplete status into labour_attendance.status");
assert.doesNotMatch(attendanceApi, /standard-attendance-save|debugSaveTrace|console\.info/, "Server save diagnostics must not leave temporary debug tracing");
assert.doesNotMatch(attendancePage, /standard-attendance-save|debugSaveDraftTrace|console\.info/, "Client save diagnostics must not leave temporary debug tracing");
assert.match(attendanceApi, /\["submitted", "finalized", "approved"\]\.includes\(selectedStatus\) && dateAuthority\.latestSubmitted/, "Snapshot hydration must only take over for submitted-like dates");
assert.match(attendanceApi, /loadStandardPopulation\(access, \{[\s\S]+contractorProfileId/, "Draft load/save population must remain contractor aware");
assert.match(labourShared, /if \(input\.contractorProfileId\) query = query\.eq\("contractor_profile_id", input\.contractorProfileId\)/, "Eligible deployment loading must enforce selected contractor server-side");
assert.match(attendanceApi, /dateAuthority\.submittedSnapshotLocked/, "Historical access alone must not reopen a submitted snapshot");

assert.match(attendancePage, /params\.set\("contractor_profile_id", requestContext\.contractor_profile_id\)/, "Load Attendance must send selected contractor to the API");
assert.match(attendancePage, /contractor_profile_id: filters\.contractor_profile_id \|\| null/, "Save Draft must send selected contractor to the API");
assert.match(attendancePage, /filters\.attendance_date, filters\.contractor_profile_id \|\| ""/, "Loaded attendance context must include contractor");
assert.match(attendancePage, /if \(!attendanceLoaded\) \{\s*setMessage\(mode === "submit" \? "Load attendance before submitting\." : "Load attendance for the selected filters before saving\."\);[\s\S]+return false;\s*\}/, "Save Draft must explain stale or missing loaded context instead of silently doing nothing");
assert.match(attendancePage, /onClick=\{saveRows\} disabled=\{saving \|\| submitting\}/, "Save Draft must remain clickable so stale context can show a clear message");
assert.match(attendancePage, /const changed = mode === "submit" \? rows : rows\.filter\(\(row\) => dirtyWorkerIds\.has\(row\.labour_worker_id\)\)/, "Save Draft must persist dirty rows without inventing untouched rows");
assert.match(attendancePage, /if \(mode === "draft"\) setSubmitError\(""\);[\s\S]+if \(!attendanceLoaded\)/, "Fresh Save Draft attempts must clear stale submit errors before any early return");
assert.match(attendancePage, /const active = value === nextValue/, "Shift buttons must use strict tri-state matching, not truthiness");
assert.doesNotMatch(attendancePage, /!row\.first_half_present|!row\.second_half_present|!saved\?\.first_half_present|!saved\?\.second_half_present/, "NULL attendance halves must not be rendered as Absent through truthiness");
assert.match(attendancePage, /rows\.filter\(\(row\) => row\.first_half_present == null \|\| row\.second_half_present == null\)/, "NULL rows must remain incomplete for submit validation");
assert.match(attendancePage, /updateRow\(workerId, \{ \[field\]: status/, "Clicking Present/Absent on a NULL half must set an explicit value and mark dirty");
assert.match(attendancePage, /function updateRow[\s\S]+setSubmitError\(""\);[\s\S]+setSubmitSuccessMessage\(""\);/, "Editing attendance must clear stale submit and success banners");
assert.match(attendancePage, /updateRow\(workerId, \{ \[field\]: status, \[existingField\]: status === "present"/, "Clicking Present/Absent must keep raw half-day values in sync with visible shift status");
assert.match(attendancePage, /first_shift_status: status,[\s\S]+second_shift_status: status,[\s\S]+setDirtyWorkerIds\(\(current\) => new Set\(\[\.\.\.current, \.\.\.displayedRows\.map/, "Mark All Present/Absent must convert visible NULL rows to explicit values and mark them dirty");
assert.match(attendancePage, /first_shift_status: status,[\s\S]+second_shift_status: status,[\s\S]+first_half_present: status === "present",[\s\S]+second_half_present: status === "present"/, "Mark All Present/Absent must keep raw half-day values in sync with visible shift status");
assert.match(attendancePage, /first_shift_status: null,[\s\S]+second_shift_status: null,[\s\S]+first_half_present: null,[\s\S]+second_half_present: null/, "Clear/Reset must restore raw half-day values to incomplete NULL");
assert.match(attendancePage, /const expectedSavedCount = changed\.length/, "Save Draft must capture the intended dirty-row count before POST");
assert.match(attendancePage, /confirmedSavedCount !== expectedSavedCount/, "Save Draft must reject saved-count mismatches");
assert.match(attendancePage, /Attendance save could not be confirmed\. Expected \$\{expectedSavedCount\} rows, server confirmed/, "Saved-count mismatch must show a clear unconfirmed-save message");
assert.match(attendancePage, /savedWorkerIds\.forEach\(\(workerId\) => next\.delete\(workerId\)\)/, "Successful Save Draft must clear only the confirmed worker IDs");
assert.match(attendancePage, /catch \{\s*setMessage\("Attendance save could not be confirmed\. Your unsaved changes have been kept\."\)/, "Malformed save responses must preserve dirty state");
assert.match(attendancePage, /setMessage\(`Saved \$\{payload\.saved\} attendance rows\.`\);[\s\S]+setSubmitError\(""\);[\s\S]+setSubmitSuccessMessage\(""\);/, "Confirmed Save Draft must clear stale submitted-error banners");
assert.match(attendancePage, /setSubmitError\(""\);[\s\S]+setRows\(\[\]\)/, "Fresh load must clear stale submit errors");
assert.match(attendancePage, /function applyFilterChange[\s\S]+setSubmitError\(""\);[\s\S]+setRows\(\[\]\)/, "Changing the load context must clear stale submit errors");
assert.match(attendancePage, /"contractor_profile_id" in patch[\s\S]+setSubmitError\(""\)/, "Contractor changes must clear stale submit errors");
assert.match(attendancePage, /"contractor_profile_id" in patch[\s\S]+if \(hasUnsavedChanges\) \{\s*setUnsavedAction\(\(\) => action\);[\s\S]+return;[\s\S]+\}\s*action\(\);/, "Contractor changes with dirty rows must use the existing unsaved-change protection");
assert.match(attendancePage, /setDirtyWorkerIds\(\(current\) => new Set\(\[\.\.\.current, \.\.\.displayedRows\.map\(\(row\) => row\.labour_worker_id\)\]\)\)/, "Mark All Present/Absent must still mark visible intended rows dirty");

assert.match(submitApi, /loadLabourAttendanceDateAuthority/, "Submit must use snapshot-backed date authority");
assert.match(submitApi, /submittedSnapshotLocked/, "Submit must preserve submitted-date lock behavior");
assert.match(approvalApi, /labour_attendance_submission_versions/, "Approval regression path must continue to read submitted snapshots");
assert.match(attendanceApi, /if \(!changes\.length\) return jsonError\("No attendance changes to save\.", 400\)/, "Zero-row API saves must be rejected");
assert.match(attendanceApi, /Attendance could not be saved for worker \$\{workerId \|\| "unknown"\}: worker is not eligible for the selected Site\/date\/contractor\./, "Invalid bulk rows must return a useful non-sensitive worker-specific failure");
assert.match(attendanceApi, /\.upsert\(rows, \{ onConflict: "period_id,labour_worker_id,attendance_date" \}\)\s*\.select\("labour_worker_id"\)/, "Attendance API must request database-returned rows from period-scoped upsert");
assert.match(attendanceApi, /const savedCount = savedRows\?\.length \|\| 0/, "Attendance API must derive saved count from returned rows");
assert.match(attendanceApi, /if \(savedCount !== rows\.length\)/, "Attendance API must reject database confirmation mismatches");
assert.match(attendanceApi, /return NextResponse\.json\(\{ saved: savedCount \}\)/, "Attendance API must return database-confirmed saved count");
assert.match(attendanceApi, /includes\("Attendance for this date has already been submitted\."\)[\s\S]+jsonError\("Attendance for this date has already been submitted\. Reopen the date before making changes\.", 409\)/, "Database submitted-date guard errors must return a business-conflict status instead of HTTP 500");

console.log("Labour attendance state/save/reload regression rules passed.");
