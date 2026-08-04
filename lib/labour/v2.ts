import { normalizeText } from "@/lib/labour/constants";

export const COMMERCIAL_MODELS = ["contract_basis", "daily_wage"] as const;
export const MANPOWER_WORK_ORDER_STATUSES = ["draft", "submitted", "approved", "suspended", "completed", "cancelled"] as const;
export const MANPOWER_ENGAGEMENT_TYPES = ["daily_wage", "direct_labour"] as const;
export const OVERTIME_BASIS = ["hourly", "fixed_per_hour", "category_rate"] as const;
export const CONTRACTOR_PROFIT_TYPES = ["none", "percentage", "fixed_per_labour_day"] as const;
export const LABOUR_WORK_LOG_STATUSES = ["draft", "submitted", "verified", "approved", "rejected", "locked"] as const;
export const LABOUR_WORK_GROUP_STATUSES = ["draft", "submitted", "verified", "approved", "locked"] as const;
export const LABOUR_OVERTIME_STATUSES = ["draft", "submitted", "verified", "approved", "rejected", "locked"] as const;
export const LABOUR_WORK_TYPES = ["productive", "non_productive"] as const;
export const NON_PRODUCTIVE_REASONS = [
  "cleaning",
  "waiting_for_material",
  "waiting_for_drawing",
  "machine_breakdown",
  "no_work_front",
  "shifting_material",
  "safety_meeting",
  "weather",
  "rework",
  "other",
] as const;

export function isAllowed<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return values.includes(String(value || "") as T[number]);
}

export function dateText(value: unknown) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function timeText(value: unknown) {
  const text = normalizeText(value);
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text) ? text.slice(0, 5) : null;
}

export function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function boolValue(value: unknown) {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function previousDate(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

export function rangesOverlap(aFrom: string, aTo: string | null | undefined, bFrom: string, bTo: string | null | undefined) {
  return aFrom <= (bTo || "9999-12-31") && bFrom <= (aTo || "9999-12-31");
}

export function calculateDailyWageLine(input: {
  status: string;
  dailyRate: number;
  approvedOvertimeMinutes?: number | null;
  shiftHours?: number | null;
  contractorProfitType?: string | null;
  contractorProfitValue?: number | null;
}) {
  const attendanceUnits = input.status === "present" ? 1 : input.status === "half_day" ? 0.5 : 0;
  const overtimeHours = Math.max(0, Number(input.approvedOvertimeMinutes || 0)) / 60;
  const overtimeDays = overtimeHours / (Number(input.shiftHours || 0) > 0 ? Number(input.shiftHours) : 8);
  const payableDays = attendanceUnits + overtimeDays;
  const amount = payableDays * input.dailyRate;
  let contractorProfit = 0;
  if (input.contractorProfitType === "percentage") contractorProfit = amount * (Number(input.contractorProfitValue || 0) / 100);
  if (input.contractorProfitType === "fixed_per_labour_day") contractorProfit = attendanceUnits * Number(input.contractorProfitValue || 0);
  return {
    attendance_units: attendanceUnits,
    overtime_days: Math.round(overtimeDays * 100) / 100,
    payable_days: Math.round(payableDays * 100) / 100,
    basic_wage: Math.round(amount * 100) / 100,
    overtime_amount: 0,
    contractor_profit: Math.round(contractorProfit * 100) / 100,
    gross_payable: Math.round((amount + contractorProfit) * 100) / 100,
  };
}
