import { normalizeAadhaar } from "@/lib/utils/aadhaar";

export const LABOUR_STATUSES = ["active", "inactive", "exited", "suspended", "deleted"] as const;
export const CONTRACTOR_STATUSES = ["active", "inactive", "suspended", "blacklisted"] as const;
export const SKILL_LEVELS = ["unskilled", "semi_skilled", "skilled", "highly_skilled"] as const;
export const WORKER_TYPES = ["contractor_labour", "direct_labour"] as const;
export const WAGE_TYPES = ["daily", "monthly", "hourly", "piece_rate"] as const;
export const LABOUR_ATTENDANCE_STATUSES = ["present", "absent", "half_day", "weekly_off", "holiday", "leave", "not_deployed"] as const;
export const LABOUR_ATTENDANCE_PERIOD_STATUSES = ["draft", "submitted", "finalized", "reopened", "cancelled"] as const;
export const LABOUR_WAGE_PERIOD_STATUSES = ["draft", "calculated", "submitted", "finalized", "reopened", "cancelled"] as const;
export const LABOUR_PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid"] as const;
export const LABOUR_ADVANCE_STATUSES = ["active", "recovered", "cancelled"] as const;
export const LABOUR_RECOVERY_MODES = ["one_time", "installment", "manual"] as const;
export const LABOUR_OVERTIME_RATE_TYPES = ["hourly", "multiplier", "fixed"] as const;

export const LABOUR_DOCUMENT_TYPES = [
  "Aadhaar",
  "Aadhaar Card",
  "Aadhaar Front",
  "Aadhaar Back",
  "PAN",
  "Voter ID",
  "Driving Licence",
  "Bank Passbook",
  "ESIC Card",
  "PF / UAN",
  "Bank Proof",
  "Photo",
  "UAN Card",
  "ESI Card",
  "Police Verification",
  "Medical Certificate",
  "Skill Certificate",
  "Experience Certificate",
  "Other",
] as const;

export const LABOUR_CONTRACTOR_DOCUMENT_TYPES = [
  "Labour Licence",
  "EPF Certificate",
  "ESIC Certificate",
  "Agreement",
  "Other",
] as const;

export type LabourStatus = (typeof LABOUR_STATUSES)[number];
export type ContractorStatus = (typeof CONTRACTOR_STATUSES)[number];
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export type WorkerType = (typeof WORKER_TYPES)[number];
export type WageType = (typeof WAGE_TYPES)[number];
export type LabourAttendanceStatus = (typeof LABOUR_ATTENDANCE_STATUSES)[number];
export type LabourAttendancePeriodStatus = (typeof LABOUR_ATTENDANCE_PERIOD_STATUSES)[number];
export type LabourWagePeriodStatus = (typeof LABOUR_WAGE_PERIOD_STATUSES)[number];
export type LabourPaymentStatus = (typeof LABOUR_PAYMENT_STATUSES)[number];
export type LabourAdvanceStatus = (typeof LABOUR_ADVANCE_STATUSES)[number];
export type LabourRecoveryMode = (typeof LABOUR_RECOVERY_MODES)[number];
export type LabourOvertimeRateType = (typeof LABOUR_OVERTIME_RATE_TYPES)[number];

export function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeLookup(value: unknown) {
  return normalizeText(value).toUpperCase();
}

export function normalizeIdentifier(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.replace(/\s+/g, "").toUpperCase();
  if (["0", "0.0", "0.00", "-", "NA", "N/A", "NIL", "NONE", "NULL", "NOTAVAILABLE", "NOT AVAILABLE"].includes(normalized)) {
    return null;
  }
  return normalized;
}

export function isValidActionValue<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

export function labelFromCode(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeLabourCode(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, "") || "0";
  return normalizeLookup(text);
}

export function formatLabourCode(value: string | number | null | undefined) {
  const text = normalizeText(value);
  if (!text) return "-";
  if (/^\d+$/.test(text)) return String(Number(text)).padStart(3, "0");
  return text;
}

export function maskAadhaar(value: string | null | undefined) {
  const normalized = normalizeAadhaar(value);
  if (!normalized) return "-";
  return normalized.length > 4 ? `••••••••${normalized.slice(-4)}` : normalized;
}

export function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
