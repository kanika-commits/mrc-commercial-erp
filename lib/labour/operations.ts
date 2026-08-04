import {
  LABOUR_ATTENDANCE_STATUSES,
  WAGE_TYPES,
  type LabourAttendanceStatus,
  type WageType,
} from "@/lib/labour/constants";

export const IST_TIME_ZONE = "Asia/Kolkata";
export const LABOUR_MIN_PRESENT_MINUTES = 240;

export function isoDate(value: unknown) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

export function monthStart(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
}

export function todayInIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function isMonthEnded(periodMonth: string, now = new Date()) {
  const [year, month] = periodMonth.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  return todayInIst(now) >= nextMonth.toISOString().slice(0, 10);
}

export function isPastDate(dateText: string, now = new Date()) {
  return dateText < todayInIst(now);
}

export function isFutureDate(dateText: string, now = new Date()) {
  return dateText > todayInIst(now);
}

export function labourPolicyLockCutoff(input: {
  attendanceDate: string;
  shiftEndTime?: string | null;
  delayHours?: number | null;
  timezone?: string | null;
}) {
  const shiftEnd = String(input.shiftEndTime || "").trim();
  if (!input.attendanceDate || !/^\d{2}:\d{2}/.test(shiftEnd)) return null;
  const delay = Math.max(0, Math.min(168, Math.round(Number(input.delayHours ?? 0))));
  const timezone = input.timezone || IST_TIME_ZONE;
  if (timezone !== IST_TIME_ZONE) {
    return new Date(`${input.attendanceDate}T${shiftEnd.slice(0, 5)}:00Z`);
  }
  const cutoff = new Date(`${input.attendanceDate}T${shiftEnd.slice(0, 5)}:00+05:30`);
  cutoff.setHours(cutoff.getHours() + delay);
  return cutoff;
}

export function labourDayEndLockCutoff(input: {
  attendanceDate: string;
  delayHours?: number | null;
  timezone?: string | null;
}) {
  if (!input.attendanceDate) return null;
  const delay = Math.max(1, Math.min(168, Math.round(Number(input.delayHours ?? 1))));
  const timezone = input.timezone || IST_TIME_ZONE;
  if (timezone !== IST_TIME_ZONE) {
    const cutoff = new Date(`${input.attendanceDate}T23:59:00Z`);
    cutoff.setHours(cutoff.getHours() + delay);
    return cutoff;
  }
  const cutoff = new Date(`${input.attendanceDate}T23:59:00+05:30`);
  cutoff.setHours(cutoff.getHours() + delay);
  return cutoff;
}

export function isAfterLabourDayEndLockCutoff(input: {
  attendanceDate: string;
  delayHours?: number | null;
  timezone?: string | null;
  now?: Date;
}) {
  const cutoff = labourDayEndLockCutoff(input);
  if (!cutoff) return false;
  return (input.now || new Date()).getTime() >= cutoff.getTime();
}

export function isAfterLabourPolicyLockCutoff(input: {
  attendanceDate: string;
  shiftEndTime?: string | null;
  delayHours?: number | null;
  timezone?: string | null;
  now?: Date;
}) {
  const cutoff = labourPolicyLockCutoff(input);
  if (!cutoff) return false;
  return (input.now || new Date()).getTime() >= cutoff.getTime();
}

export function isAttendanceStatus(value: string): value is LabourAttendanceStatus {
  return LABOUR_ATTENDANCE_STATUSES.includes(value as LabourAttendanceStatus);
}

export function workedMinutesBetween(startTime?: string | null, endTime?: string | null) {
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

function minutesFromTime(value?: string | null) {
  const text = String(value || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

export function labourAttendanceTiming(input: {
  attendanceDate: string;
  startTime?: string | null;
  endTime?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
}) {
  const start = minutesFromTime(input.startTime);
  const end = minutesFromTime(input.endTime);
  const shiftStart = minutesFromTime(input.shiftStartTime);
  const shiftEnd = minutesFromTime(input.shiftEndTime);
  if (start === null || end === null) {
    return { workedMinutes: null, overtimeMinutes: 0, shiftEndOffsetMinutes: shiftEnd };
  }

  let actualStart = start;
  let actualEnd = end;
  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart && actualStart < shiftEnd) {
    actualStart += 24 * 60;
    actualEnd += 24 * 60;
  }
  if (actualEnd <= actualStart) actualEnd += 24 * 60;

  let shiftEndOffset = shiftEnd;
  if (shiftStart !== null && shiftEnd !== null && shiftEndOffset !== null && shiftEndOffset <= shiftStart) {
    shiftEndOffset += 24 * 60;
  }

  const workedMinutes = actualEnd - actualStart;
  const overtimeMinutes = Math.max(0, workedMinutes - 480);
  return { workedMinutes, overtimeMinutes, shiftEndOffsetMinutes: shiftEndOffset };
}

export function validateLabourPresentTiming(input: { status: string; startTime?: string | null; endTime?: string | null }) {
  if (input.status !== "present") return null;
  const workedMinutes = workedMinutesBetween(input.startTime, input.endTime);
  if (workedMinutes === null || workedMinutes < LABOUR_MIN_PRESENT_MINUTES) {
    return "A labourer must work at least 4 hours to be marked Present.";
  }
  return null;
}

export function isWageType(value: string): value is WageType {
  return WAGE_TYPES.includes(value as WageType);
}

export function overlapsDateRange(
  startA: string,
  endA: string | null | undefined,
  startB: string,
  endB: string | null | undefined,
) {
  const aEnd = endA || "9999-12-31";
  const bEnd = endB || "9999-12-31";
  return startA <= bEnd && startB <= aEnd;
}

export function statusUnits(status: LabourAttendanceStatus, flags?: { weeklyOffPaid?: boolean; holidayPaid?: boolean }) {
  if (status === "present") return { payable: 1, present: 1, half: 0 };
  if (status === "half_day") return { payable: 0.5, present: 0, half: 1 };
  if (status === "weekly_off") return { payable: flags?.weeklyOffPaid ? 1 : 0, present: 0, half: 0 };
  if (status === "holiday") return { payable: flags?.holidayPaid ? 1 : 0, present: 0, half: 0 };
  return { payable: 0, present: 0, half: 0 };
}

export function attendanceCode(status: string | null | undefined) {
  switch (status) {
    case "present": return "P";
    case "absent": return "A";
    case "half_day": return "HD";
    case "weekly_off": return "WO";
    case "holiday": return "H";
    case "leave": return "L";
    case "not_deployed": return "ND";
    default: return "";
  }
}

export function calculateDailyWage(input: {
  attendance: Array<{ status: LabourAttendanceStatus; overtime_minutes?: number | null }>;
  baseRate: number;
  shiftHours?: number | null;
  weeklyOffPaid?: boolean;
  holidayPaid?: boolean;
}) {
  let presentDays = 0;
  let halfDays = 0;
  let weeklyOffDays = 0;
  let holidayDays = 0;
  let leaveDays = 0;
  let payableDays = 0;
  let overtimeMinutes = 0;

  for (const row of input.attendance) {
    const units = statusUnits(row.status, { weeklyOffPaid: input.weeklyOffPaid, holidayPaid: input.holidayPaid });
    presentDays += units.present;
    halfDays += units.half;
    payableDays += units.payable;
    overtimeMinutes += Number(row.overtime_minutes || 0);
    if (row.status === "weekly_off") weeklyOffDays += 1;
    if (row.status === "holiday") holidayDays += 1;
    if (row.status === "leave") leaveDays += 1;
  }

  const overtimeHours = overtimeMinutes / 60;
  const shiftHours = Number(input.shiftHours || 0) > 0 ? Number(input.shiftHours) : 8;
  const overtimeDays = overtimeHours / shiftHours;
  const totalPayableDays = payableDays + overtimeDays;
  const basicWages = roundMoney(totalPayableDays * input.baseRate);

  return {
    present_days: presentDays,
    half_days: halfDays,
    weekly_off_days: weeklyOffDays,
    holiday_days: holidayDays,
    leave_days: leaveDays,
    overtime_minutes: overtimeMinutes,
    overtime_hours: roundNumber(overtimeHours),
    overtime_days: roundNumber(overtimeDays),
    attendance_days: roundNumber(payableDays),
    payable_days: roundNumber(totalPayableDays),
    basic_wages: basicWages,
    overtime_amount: 0,
    gross_wages: basicWages,
  };
}

export function shiftHoursFromTimes(startTime?: string | null, endTime?: string | null) {
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return 8;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return roundNumber(minutes / 60) || 8;
}

export function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function roundNumber(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function normalizedContractorKey(contractorProfileId?: string | null) {
  return contractorProfileId || "direct";
}

export function buildLabourAttendanceUpsertPayload(input: {
  existingRow?: Record<string, any> | null;
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  labourWorkerId: string;
  deploymentId: string;
  periodId: string;
  attendanceDate: string;
  status: LabourAttendanceStatus;
  overtimeMinutes: number;
  remarks?: string | null;
  source: "manual" | "system" | "import";
  backdatedReason?: string | null;
  importBatchId?: string | null;
  importRowId?: string | null;
  actorId: string;
  actorName: string;
  actorEmail?: string | null;
  now: string;
  extra?: Record<string, any>;
}) {
  const payload: Record<string, any> = {
    organization_id: input.organizationId,
    company_id: input.companyId,
    site_id: input.siteId,
    contractor_profile_id: input.contractorProfileId || null,
    labour_worker_id: input.labourWorkerId,
    deployment_id: input.deploymentId,
    period_id: input.periodId,
    attendance_date: input.attendanceDate,
    status: input.status,
    overtime_minutes: Math.max(0, Math.round(Number(input.overtimeMinutes || 0))),
    remarks: input.remarks || null,
    source: input.source,
    backdated_reason: input.backdatedReason || null,
    import_batch_id: input.importBatchId || null,
    import_row_id: input.importRowId || null,
    updated_at: input.now,
    updated_by: input.actorId,
    updated_by_name: input.actorName,
    updated_by_email: input.actorEmail || null,
    ...(input.extra || {}),
  };

  if (!input.existingRow) {
    payload.created_by = input.actorId;
    payload.created_by_name = input.actorName;
    payload.created_by_email = input.actorEmail || null;
  }

  return payload;
}
