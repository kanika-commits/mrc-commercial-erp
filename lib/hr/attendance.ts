export const HR_ATTENDANCE_MODULE = "hr_attendance";
export const HR_ATTENDANCE_APPROVAL_MODULE = "hr_attendance_approval";
export const HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE = "hr_employee_attendance_policy";
export const EMPLOYEE_STANDARD_WORKING_HOURS = 8;
export const EMPLOYEE_ATTENDANCE_LOCK_REFERENCE = "attendance_day_end_2359_ist";

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "half_day",
  "paid_leave",
  "unpaid_leave",
  "weekly_off",
  "holiday",
  "work_from_home",
  "on_duty",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const PHASE1_ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "half_day",
] as const satisfies readonly AttendanceStatus[];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half Day",
  paid_leave: "Paid Leave",
  unpaid_leave: "Unpaid Leave",
  weekly_off: "Weekly Off",
  holiday: "Holiday",
  work_from_home: "Work From Home",
  on_duty: "On Duty",
};

export const ATTENDANCE_STATUS_CODES: Record<AttendanceStatus, string> = {
  present: "P",
  absent: "A",
  half_day: "HD",
  paid_leave: "PL",
  unpaid_leave: "UPL",
  weekly_off: "WO",
  holiday: "H",
  work_from_home: "WFH",
  on_duty: "OD",
};

export const ATTENDANCE_PERIOD_STATUSES = [
  "draft",
  "submitted",
  "level_1_approved",
  "level_2_approved",
  "finalized",
  "reopened",
  "cancelled",
] as const;

export type AttendancePeriodStatus = (typeof ATTENDANCE_PERIOD_STATUSES)[number];

export type AttendanceSummary = Record<AttendanceStatus | "missing" | "total_recorded", number>;

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return ATTENDANCE_STATUSES.includes(String(value || "") as AttendanceStatus);
}

export function normalizeIsoDate(value: unknown) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function monthStart(value: unknown) {
  const date = normalizeIsoDate(value);
  if (!date) return null;
  return `${date.slice(0, 7)}-01`;
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function monthEnd(month: string) {
  const count = daysInMonth(month);
  return `${month.slice(0, 8)}${String(count).padStart(2, "0")}`;
}

export function datesForMonth(month: string) {
  const count = daysInMonth(month);
  return Array.from({ length: count }, (_, index) => `${month.slice(0, 8)}${String(index + 1).padStart(2, "0")}`);
}

export function currentIndiaDate(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function previousDate(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function compareDates(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function hasMonthEnded(month: string, today = currentIndiaDate()) {
  return compareDates(monthEnd(month), today) < 0;
}

export function canLockAttendanceDate(attendanceDate: string, today = currentIndiaDate()) {
  return compareDates(attendanceDate, today) < 0;
}

export function employeeAttendanceLockCutoff(values: { attendanceDate: string; lockAfterHours: number }) {
  const hours = Math.max(0, Math.min(168, Math.round(Number(values.lockAfterHours || 0))));
  const cutoff = new Date(`${values.attendanceDate}T23:59:00+05:30`);
  cutoff.setHours(cutoff.getHours() + hours);
  return cutoff;
}

export function isAfterEmployeeAttendanceLockCutoff(values: { attendanceDate: string; lockAfterHours: number; now?: Date }) {
  return (values.now || new Date()).getTime() >= employeeAttendanceLockCutoff(values).getTime();
}

export function requiresBackdatedReason(attendanceDate: string, isAdminRecovery: boolean, today = currentIndiaDate()) {
  return isAdminRecovery && compareDates(attendanceDate, previousDate(today)) < 0;
}

export function canEditAttendanceDate(attendanceDate: string, isAdminRecovery: boolean, reason?: string | null, today = currentIndiaDate()) {
  const comparison = compareDates(attendanceDate, today);
  if (comparison > 0 && !isAdminRecovery) return { allowed: false, error: "Future attendance cannot be created or edited." };
  if (comparison === 0) return { allowed: true, backdated: false };
  const olderThanYesterday = compareDates(attendanceDate, previousDate(today)) < 0;
  if (!isAdminRecovery && olderThanYesterday) {
    return { allowed: false, error: "Attendance can be edited only for today or yesterday." };
  }
  if (!olderThanYesterday) return { allowed: true, backdated: false };
  if (!String(reason || "").trim()) return { allowed: false, error: "Backdated attendance reason is required." };
  return { allowed: true, backdated: true };
}

export function canSelectAttendanceDate(attendanceDate: string, isAdminRecovery: boolean, today = currentIndiaDate()) {
  if (isAdminRecovery) return { allowed: true };
  const comparison = compareDates(attendanceDate, today);
  if (comparison > 0) return { allowed: false, error: "Future attendance cannot be loaded." };
  if (compareDates(attendanceDate, previousDate(today)) < 0) {
    return { allowed: false, error: "Attendance can be loaded only for today or yesterday." };
  }
  return { allowed: true };
}

export function isEmployeeEligibleForDate(employee: {
  date_of_joining?: string | null;
  date_of_exit?: string | null;
  status?: string | null;
}, attendanceDate: string) {
  if (String(employee.status || "").toLowerCase() === "deleted") return false;
  if (employee.date_of_joining && compareDates(attendanceDate, employee.date_of_joining) < 0) return false;
  if (employee.date_of_exit && compareDates(attendanceDate, employee.date_of_exit) > 0) return false;
  return true;
}

export function blankSummary(): AttendanceSummary {
  return {
    present: 0,
    absent: 0,
    half_day: 0,
    paid_leave: 0,
    unpaid_leave: 0,
    weekly_off: 0,
    holiday: 0,
    work_from_home: 0,
    on_duty: 0,
    missing: 0,
    total_recorded: 0,
  };
}

export function summarizeAttendance(statuses: Array<AttendanceStatus | null | undefined>, expectedCount = statuses.length) {
  const summary = blankSummary();
  for (const status of statuses) {
    if (status && isAttendanceStatus(status)) {
      summary[status] += 1;
      summary.total_recorded += 1;
    }
  }
  summary.missing = Math.max(0, expectedCount - summary.total_recorded);
  return summary;
}

export function actorName(user: { user_metadata?: Record<string, any> | null; email?: string | null }) {
  return user.user_metadata?.full_name || user.user_metadata?.name || user.email || "HR User";
}

export function isAdminRecoveryRole(roleCodes: string[]) {
  return roleCodes.includes("platform_owner") || roleCodes.includes("super_admin");
}

export function buildAttendanceUpsertPayload(values: {
  existingRow?: Record<string, any> | null;
  organizationId: string;
  companyId: string;
  siteId: string;
  employeeId: string;
  periodId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  remarks?: string | null;
  backdatedReason?: string | null;
  actorId: string;
  actorName: string;
  actorEmail?: string | null;
  now: string;
}) {
  const existing = values.existingRow || null;
  const payload: Record<string, any> = {
    organization_id: values.organizationId,
    company_id: values.companyId,
    site_id: values.siteId,
    employee_id: values.employeeId,
    period_id: values.periodId,
    attendance_date: values.attendanceDate,
    status: values.status,
    remarks: String(values.remarks || "").trim() || null,
    source: "manual",
    backdated_reason: String(values.backdatedReason || "").trim() || null,
    created_by: existing?.created_by || values.actorId,
    created_by_name: existing?.created_by_name || values.actorName,
    created_by_email: existing?.created_by_email || values.actorEmail || null,
    updated_by: values.actorId,
    updated_by_name: values.actorName,
    updated_by_email: values.actorEmail || null,
    updated_at: values.now,
  };

  if (existing?.id) {
    payload.id = existing.id;
  }

  return payload;
}
