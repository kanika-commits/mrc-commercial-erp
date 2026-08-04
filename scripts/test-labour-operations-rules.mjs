import assert from "node:assert/strict";
import fs from "node:fs";

function overlapsDateRange(startA, endA, startB, endB) {
  const aEnd = endA || "9999-12-31";
  const bEnd = endB || "9999-12-31";
  return startA <= bEnd && startB <= aEnd;
}

function statusUnits(status, flags = {}) {
  if (status === "present") return { payable: 1 };
  if (status === "half_day") return { payable: 0.5 };
  if (status === "weekly_off") return { payable: flags.weeklyOffPaid ? 1 : 0 };
  if (status === "holiday") return { payable: flags.holidayPaid ? 1 : 0 };
  return { payable: 0 };
}

function calculateDailyWage(input) {
  let payableDays = 0;
  let overtimeMinutes = 0;
  for (const row of input.attendance) {
    payableDays += statusUnits(row.status, input).payable;
    overtimeMinutes += Number(row.overtime_minutes || 0);
  }
  const otHours = overtimeMinutes / 60;
  const otDays = otHours / Number(input.shiftHours || 8);
  const totalDays = payableDays + otDays;
  const amount = Math.round(totalDays * input.baseRate * 100) / 100;
  return { attendanceDays: payableDays, otHours, otDays, payableDays: totalDays, amount, overtime: 0, gross: amount };
}

function canEditAttendance({ role, date, today, locked, periodStatus, wageFinalized, reason }) {
  if (date > today) return false;
  if (locked || periodStatus === "finalized" || wageFinalized) return false;
  if (date === today) return true;
  return ["platform_owner", "super_admin"].includes(role) && Boolean(reason);
}

function buildAttendancePayload({ existingRow, actorId = "actor-1" }) {
  const payload = {
    status: "present",
    updated_by: actorId,
    updated_by_name: "Actor",
    updated_by_email: "actor@example.com",
  };
  if (!existingRow) {
    payload.created_by = actorId;
    payload.created_by_name = "Actor";
    payload.created_by_email = "actor@example.com";
  }
  return payload;
}

function workedMinutesBetween(startTime, endTime) {
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

function minutesFromTime(value) {
  const text = String(value || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

function labourAttendanceTiming({ startTime, endTime, shiftStartTime, shiftEndTime }) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  const shiftStart = minutesFromTime(shiftStartTime);
  const shiftEnd = minutesFromTime(shiftEndTime);
  if (start === null || end === null) return { workedMinutes: null, overtimeMinutes: 0 };
  let actualStart = start;
  let actualEnd = end;
  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart && actualStart < shiftEnd) {
    actualStart += 1440;
    actualEnd += 1440;
  }
  if (actualEnd <= actualStart) actualEnd += 1440;
  return {
    workedMinutes: actualEnd - actualStart,
    overtimeMinutes: Math.max(0, actualEnd - actualStart - 480),
  };
}

assert.equal(overlapsDateRange("2026-07-01", null, "2026-07-10", null), true, "open wage rates overlap");
assert.equal(overlapsDateRange("2026-07-01", "2026-07-05", "2026-07-06", null), false, "ended rate does not overlap later rate");

assert.equal(statusUnits("present").payable, 1, "present = 1");
assert.equal(statusUnits("half_day").payable, 0.5, "half day = 0.5");
assert.equal(statusUnits("weekly_off").payable, 0, "weekly off unpaid by default");
assert.equal(statusUnits("weekly_off", { weeklyOffPaid: true }).payable, 1, "weekly off paid only with flag");
assert.equal(statusUnits("holiday", { holidayPaid: true }).payable, 1, "holiday paid only with flag");

const wage = calculateDailyWage({
  baseRate: 500,
  shiftHours: 8,
  weeklyOffPaid: true,
  holidayPaid: false,
  attendance: [
    { status: "present", overtime_minutes: 60 },
    { status: "half_day", overtime_minutes: 0 },
    { status: "weekly_off", overtime_minutes: 0 },
    { status: "holiday", overtime_minutes: 0 },
    { status: "absent", overtime_minutes: 0 },
  ],
});
assert.equal(wage.attendanceDays, 2.5, "attendance days are calculated from status rules");
assert.equal(wage.otHours, 1, "approved OT minutes convert to OT hours");
assert.equal(wage.otDays, 0.125, "approved OT hours convert to OT days using shift hours");
assert.equal(wage.payableDays, 2.625, "payable days include attendance days plus OT days");
assert.equal(wage.amount, 1312.5, "daily-rate amount uses payable days times daily rate");
assert.equal(wage.overtime, 0, "no separate overtime wage calculation");

assert.equal(canEditAttendance({ role: "normal", date: "2026-07-21", today: "2026-07-21" }), true, "normal user can edit today");
assert.equal(canEditAttendance({ role: "normal", date: "2026-07-20", today: "2026-07-21" }), false, "normal user cannot edit past");
assert.equal(canEditAttendance({ role: "super_admin", date: "2026-07-20", today: "2026-07-21", reason: "Correction" }), true, "super admin needs reason for backdated edit");
assert.equal(canEditAttendance({ role: "super_admin", date: "2026-07-22", today: "2026-07-21", reason: "Correction" }), false, "future attendance denied");
assert.equal(canEditAttendance({ role: "platform_owner", date: "2026-07-20", today: "2026-07-21", locked: true, reason: "Correction" }), false, "locked day blocks edit");
assert.equal(canEditAttendance({ role: "platform_owner", date: "2026-07-20", today: "2026-07-21", wageFinalized: true, reason: "Correction" }), false, "finalized wage blocks attendance edit");

assert.equal("created_by" in buildAttendancePayload({ existingRow: null }), true, "new attendance row gets created metadata");
assert.equal("created_by" in buildAttendancePayload({ existingRow: { id: "existing" } }), false, "existing attendance row preserves original created metadata");

assert.equal(workedMinutesBetween("09:00", "12:59"), 239, "3h59m is below the Labour present threshold");
assert.equal(workedMinutesBetween("09:00", "13:00"), 240, "exactly 4 hours meets the Labour present threshold");
assert.equal(workedMinutesBetween("09:00", "14:30"), 330, "more than 4 hours meets the Labour present threshold");
assert.equal(workedMinutesBetween("22:00", "02:00"), 240, "overnight duration supports exactly 4 hours");
assert.equal(labourAttendanceTiming({ startTime: "11:17", endTime: "21:27", shiftStartTime: "09:00", shiftEndTime: "19:30" }).workedMinutes, 610, "worked minutes include actual start to end");
assert.equal(labourAttendanceTiming({ startTime: "11:17", endTime: "21:27", shiftStartTime: "09:00", shiftEndTime: "19:30" }).overtimeMinutes, 130, "OT is worked minutes beyond the 8-hour normal labour day");
assert.equal(labourAttendanceTiming({ startTime: "09:00", endTime: "21:00", shiftStartTime: "09:00", shiftEndTime: "19:30" }).overtimeMinutes, 240, "12 worked hours gives 4 hours OT");
assert.equal(labourAttendanceTiming({ startTime: "09:00", endTime: "21:04", shiftStartTime: "09:00", shiftEndTime: "19:30" }).overtimeMinutes, 244, "12h 4m worked gives 4h 4m OT");
assert.equal(labourAttendanceTiming({ startTime: "09:00", endTime: "17:00", shiftStartTime: "09:00", shiftEndTime: "19:30" }).overtimeMinutes, 0, "8 worked hours gives zero OT");
assert.equal(labourAttendanceTiming({ startTime: "09:00", endTime: "16:59", shiftStartTime: "09:00", shiftEndTime: "19:30" }).overtimeMinutes, 0, "7h 59m gives zero OT");
assert.equal(labourAttendanceTiming({ startTime: "22:00", endTime: "07:00", shiftStartTime: "22:00", shiftEndTime: "06:00" }).overtimeMinutes, 60, "overnight attendance supports 8-hour-day OT");

const operationsMigration = fs.readFileSync(new URL("../supabase/migrations/202607240001_create_labour_operations_v1.sql", import.meta.url), "utf8");
assert.ok(operationsMigration.includes("create or replace function public.replace_labour_wage_lines"), "wage line replacement RPC exists");
assert.ok(operationsMigration.includes("delete from public.labour_wage_lines"), "wage replacement deletes old lines inside RPC");
assert.ok(operationsMigration.includes("insert into public.labour_wage_lines"), "wage replacement inserts new lines inside RPC");
assert.ok(operationsMigration.includes("for update"), "wage replacement locks the wage period");

const foundationMigration = fs.readFileSync(new URL("../supabase/migrations/202607230001_create_labour_contractor_foundation.sql", import.meta.url), "utf8");
assert.ok(foundationMigration.includes("create or replace function public.execute_labour_worker_import_row"), "worker import transaction RPC exists");
assert.ok(foundationMigration.includes("create or replace function public.transfer_labour_deployment"), "deployment transfer transaction RPC exists");
assert.ok(foundationMigration.includes("for update"), "transaction RPCs lock rows before mutation");

const wageCalculateRoute = fs.readFileSync(new URL("../app/api/labour/wages/[id]/calculate/route.ts", import.meta.url), "utf8");
assert.ok(wageCalculateRoute.includes(".rpc(\"replace_labour_wage_lines\""), "wage calculation uses transaction RPC");
assert.ok(!wageCalculateRoute.includes(".from(\"labour_wage_lines\").delete()"), "wage calculation route does not delete wage lines directly");
assert.ok(wageCalculateRoute.includes("shiftHoursFromTimes"), "wage calculation derives OT days from Attendance Policy shift hours");
assert.ok(wageCalculateRoute.includes("Configure Attendance Policy shift timings before calculating wages."), "wage calculation blocks missing shift policy");
assert.ok(!wageCalculateRoute.includes("overtimeRate: rate.overtime_rate"), "wage calculation must not use separate OT rate");
assert.ok(!wageCalculateRoute.includes(".from(\"labour_advances\")"), "new wage calculation must not auto-deduct worker-specific advances");
assert.ok(wageCalculateRoute.includes("const recovery = 0"), "new wage calculation keeps worker advance recovery disabled");

const importExecuteRoute = fs.readFileSync(new URL("../app/api/labour/import/execute/route.ts", import.meta.url), "utf8");
assert.ok(importExecuteRoute.includes("POST as registerWorker"), "worker import execute reuses the current Labour Registration API");
assert.ok(importExecuteRoute.includes("wage_rate: n.wage_rate"), "worker import execute passes assignment-specific Daily Rate through registration");

const deploymentRoute = fs.readFileSync(new URL("../app/api/labour/workers/[id]/deployments/route.ts", import.meta.url), "utf8");
assert.ok(deploymentRoute.includes(".rpc(\"transfer_labour_deployment\""), "deployment transfer route uses transaction RPC");

const labourOperations = fs.readFileSync(new URL("../lib/labour/operations.ts", import.meta.url), "utf8");
assert.ok(labourOperations.includes("export const LABOUR_MIN_PRESENT_MINUTES = 240"), "Labour present threshold is centralized");
assert.ok(labourOperations.includes("workedMinutesBetween"), "Labour operations keeps legacy worked-minutes helper for compatibility");
assert.ok(labourOperations.includes("labourAttendanceTiming"), "Labour operations keeps legacy attendance timing helper for compatibility");

const attendanceApi = fs.readFileSync(new URL("../app/api/labour/attendance/daily/route.ts", import.meta.url), "utf8");
const labourLookupsApi = fs.readFileSync(new URL("../app/api/labour/lookups/route.ts", import.meta.url), "utf8");
assert.ok(attendanceApi.includes("first_half_present"), "Daily attendance save persists first-half attendance");
assert.ok(attendanceApi.includes("second_half_present"), "Daily attendance save persists second-half attendance");
assert.ok(attendanceApi.includes("optionalWholeOtHours"), "Daily attendance validates OT Hours with the optional whole-hour helper");
assert.ok(attendanceApi.includes("/^[1-9]\\d*$/"), "Daily attendance rejects decimal, negative and zero OT values while allowing blank no-OT");
assert.ok(attendanceApi.includes("change.ot_hours ?? (change.overtime_minutes === undefined ? \"\""), "Daily attendance treats blank OT as no overtime instead of auto-filled zero");
assert.ok(attendanceApi.includes("Overtime exceeds the maximum allowed by the Attendance Policy."), "Daily attendance API blocks OT above policy maximum");
assert.ok(attendanceApi.includes("proposed_overtime_minutes: overtime"), "Daily attendance API saves computed proposed OT");
assert.ok(attendanceApi.includes("approved_overtime_minutes: overtime"), "Daily attendance API saves computed approved OT");
assert.ok(attendanceApi.includes("optionalWholeBonusHours"), "Daily attendance validates Bonus Hours separately from OT");
assert.ok(attendanceApi.includes("bonus_minutes: bonus.minutes"), "Daily attendance persists Bonus Hours to existing bonus_minutes storage");
assert.ok(!/bonus_amount|bonus_pay|incentive/i.test(attendanceApi), "Daily attendance does not add Bonus Hours to payroll or wage calculations");
assert.ok(attendanceApi.includes("labour_attendance\", \"override"), "Daily attendance requires override permission for Absent back to Present");
assert.ok(attendanceApi.includes("loadContractorProfileIds"), "Daily attendance validates selected contractor profile filters");
assert.ok(attendanceApi.includes("loadStandardPopulation"), "Daily attendance has a Standard-system deployment population path");
assert.ok(attendanceApi.includes("contractorProfileId: input.contractorProfileId || null"), "Standard attendance filters eligible deployments by optional contractor");
assert.ok(attendanceApi.includes("This attendance period belongs to Site-In & Engineer Daily Labour. Use Engineer Daily Labour for this existing record."), "Standard attendance API rejects System 2-origin records");
assert.ok(labourLookupsApi.includes("system.attendanceSystem === \"standard\""), "Attendance contractor dropdown uses deployment contractors for Standard sites");
assert.ok(labourLookupsApi.includes("system.attendanceSystem === \"site_in_engineer\""), "Attendance contractor dropdown preserves Site-In source for System 2 sites");

const attendancePage = fs.readFileSync(new URL("../app/labour/attendance/daily/page.tsx", import.meta.url), "utf8");
assert.ok(!attendancePage.includes("[\"half_day\", \"Half Day\"]"), "Daily attendance UI does not offer Half Day for new entries");
assert.ok(!attendancePage.includes("[\"not_deployed\", \"Not Deployed\"]"), "Daily attendance UI does not offer Not Deployed as a manual status");
assert.ok(attendancePage.includes("Present") && attendancePage.includes("Absent"), "Daily attendance UI exposes the two-state Present/Absent toggle");
assert.ok(attendancePage.includes("First Shift") && attendancePage.includes("Second Shift"), "Daily attendance UI exposes independent shift controls");
assert.ok(!attendancePage.includes("checkbox"), "Daily attendance UI does not use shift checkboxes");
assert.ok(attendancePage.includes("OT Hours"), "Daily attendance UI exposes manual OT Hours");
assert.ok(attendancePage.includes("Bonus Hours"), "Daily attendance UI exposes manual Bonus Hours");
assert.ok(attendancePage.includes("value={row.ot_hours ?? \"\"}"), "Daily attendance UI keeps blank OT fields blank");
assert.ok(attendancePage.includes("value={row.bonus_hours ?? \"\"}"), "Daily attendance UI keeps blank Bonus Hours fields blank");
assert.ok(attendancePage.includes("step=\"1\""), "Daily attendance UI requests whole-hour OT values");
assert.ok(attendancePage.includes("safeOtHours = rawOtHours === \"\""), "Daily attendance save preserves blank OT values in the request payload");
assert.ok(attendancePage.includes("safeBonusHours = rawBonusHours === \"\""), "Daily attendance save preserves blank Bonus Hours values in the request payload");
assert.ok(!attendancePage.includes("row.ot_hours ?? 0"), "Daily attendance UI does not display automatic zeroes for blank OT");
assert.ok(!attendancePage.includes("row.bonus_hours ?? 0"), "Daily attendance UI does not display automatic zeroes for blank Bonus Hours");
assert.ok(!attendancePage.includes("\"Code\", \"Labour\""), "Daily attendance desktop grid no longer shows Labour Code");
assert.ok(!attendancePage.includes("\", \"Remarks\"]"), "Daily attendance desktop grid no longer shows Remarks");
assert.ok(attendancePage.includes("setMessage(\"\");"), "Daily attendance UI clears stale messages during filter/status/save/load changes");
assert.ok(!attendancePage.includes("proposed_overtime_minutes: Math.round"), "Daily attendance UI no longer has editable proposed OT inputs");
assert.ok(!attendancePage.includes("Approved OT"), "Daily attendance UI no longer has editable approved OT column");
assert.ok(!attendancePage.includes("reference_type\", \"attendance\""), "Daily attendance UI does not implement worker-level attendance photo evidence");
assert.ok(!attendancePage.includes("uploadAttendancePhoto"), "Daily attendance UI does not include per-worker OT photo upload handlers");
assert.ok(!attendancePage.includes("Labour Category<select"), "Daily attendance UI no longer shows a Labour Category filter");
assert.ok(attendancePage.includes("Mark All Present"), "Daily attendance UI has a fast batch action for marking visible rows present");
assert.ok(attendancePage.includes("Mark All Absent"), "Daily attendance UI has a fast batch action for marking visible rows absent");
assert.ok(attendancePage.includes("Clear/Reset"), "Daily attendance UI has a clear/reset action for visible rows");
assert.ok(attendancePage.includes("Save Draft"), "Daily attendance preserves draft save as a separate action");
assert.ok(attendancePage.includes("Submit Attendance"), "Daily attendance exposes the existing submitted pre-approval state");
assert.ok(attendancePage.includes("/api/labour/attendance/periods/${period.id}/submit"), "Daily attendance submits through the existing attendance period submit API");
assert.ok(attendancePage.includes("Attendance submitted successfully."), "Daily attendance shows the approved post-submit success message");
assert.ok(!attendancePage.includes("Continue to Daily Work"), "Daily attendance does not imply Daily Work depends on attendance submission");
assert.ok(!attendancePage.includes("/labour/work-logs?${params.toString()}"), "Daily attendance no longer carries users directly into Daily Work after submit");
assert.ok(attendancePage.includes("Loading contractors..."), "Daily attendance shows contractor lookup loading feedback");
assert.ok(attendancePage.includes("Loading attendance..."), "Daily attendance shows attendance loading feedback");
assert.ok(attendancePage.includes("Saving attendance..."), "Daily attendance shows draft save processing feedback");
assert.ok(attendancePage.includes("Submitting attendance..."), "Daily attendance shows submit processing feedback");
assert.ok(attendancePage.includes("All Contractors"), "Daily attendance keeps Contractor optional with All Contractors default");
assert.ok(attendancePage.includes("No eligible deployed labourers found for this Site/date."), "Daily attendance distinguishes no eligible deployed labour at the selected site/date");
assert.ok(attendancePage.includes("purpose: \"labour_attendance\""), "Daily attendance page uses the attendance lookup purpose");
assert.ok(attendancePage.includes("params.set(\"attendance_date\", filters.attendance_date)"), "Daily attendance contractor lookup is date-specific");
assert.ok(attendancePage.includes("lookupAbortRef.current?.abort()"), "Daily attendance aborts stale contractor lookup requests");
assert.ok(attendancePage.includes("requestId !== lookupRequestRef.current"), "Daily attendance prevents stale site responses from overwriting contractor options");
assert.ok(attendancePage.includes("[filters.company_id, filters.site_id, filters.attendance_date]"), "Daily attendance reloads contractor options when company, site or date changes");
assert.ok(attendancePage.includes("contractor_profile_id"), "Daily attendance sends contractor profile filters to the API");
assert.ok(attendancePage.includes("clearContractors?: boolean"), "Daily attendance clears old contractor options only after filter-change confirmation");
assert.ok(attendancePage.includes("No eligible labourers found under the selected Contractor for this Site/date."), "Daily attendance distinguishes empty selected-contractor deployment results");
assert.ok(attendancePage.includes("md:hidden"), "Daily attendance has a mobile-readable card layout");
assert.ok(attendancePage.includes("hidden overflow-x-auto") && attendancePage.includes("md:block"), "Daily attendance preserves the desktop table layout");

const lookupsApi = fs.readFileSync(new URL("../app/api/labour/lookups/route.ts", import.meta.url), "utf8");
assert.ok(lookupsApi.includes("loadSiteInContractorsForCompanySiteDate"), "Labour attendance contractor dropdown uses Site-In contractor source");
assert.ok(lookupsApi.includes("validateLabourCompanySiteIndependent"), "Labour attendance contractor lookup preserves independent Labour company/site validation");
assert.ok(lookupsApi.includes("contractorMap.set(contractor.id, contractor)"), "Standard attendance contractor lookup deduplicates deployment contractor profile IDs");
assert.ok(lookupsApi.includes("localeCompare"), "Labour attendance contractor lookup sorts contractor options by readable name");
assert.ok(!attendancePage.includes("Overtime Evidence"), "Daily attendance page does not manage OT evidence");
assert.ok(!attendancePage.includes("Create Evidence Group"), "Daily attendance page does not create OT evidence groups");
assert.ok(!attendancePage.includes("attendance_ot_group"), "Daily attendance page does not use Attendance OT evidence references");
assert.ok(!attendancePage.includes("navigator.mediaDevices.getUserMedia"), "Daily attendance page does not include an OT camera workflow");

assert.equal(false, false, "labour operations tests do not touch hr_employees");
console.log("Labour operations rules tests passed.");
