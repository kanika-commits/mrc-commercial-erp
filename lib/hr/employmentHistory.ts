export const EMPLOYMENT_HISTORY_SOURCES = ["system", "manual", "import"] as const;

export type EmploymentHistorySource = (typeof EMPLOYMENT_HISTORY_SOURCES)[number];

export const EMPLOYMENT_HISTORY_EVENTS = [
  { code: "joined", label: "Joined" },
  { code: "confirmed", label: "Confirmed" },
  { code: "company_changed", label: "Company Changed" },
  { code: "site_changed", label: "Site Changed" },
  { code: "department_changed", label: "Department Changed" },
  { code: "designation_changed", label: "Designation Changed" },
  { code: "reporting_manager_changed", label: "Reporting Manager Changed" },
  { code: "employee_type_changed", label: "Employee Type Changed" },
  { code: "shift_changed", label: "Shift Changed" },
  { code: "status_changed", label: "Status Changed" },
  { code: "promoted", label: "Promoted" },
  { code: "transferred", label: "Transferred" },
  { code: "suspended", label: "Suspended" },
  { code: "reinstated", label: "Reinstated" },
  { code: "resigned", label: "Resigned" },
  { code: "relieved", label: "Relieved" },
  { code: "rejoined", label: "Rejoined" },
  { code: "correction", label: "Employment Correction" },
  { code: "other", label: "Other" },
] as const;

export type EmploymentHistoryEventType = (typeof EMPLOYMENT_HISTORY_EVENTS)[number]["code"];

export const employmentHistoryEventLabels = new Map(
  EMPLOYMENT_HISTORY_EVENTS.map((event) => [event.code, event.label]),
);

export const EMPLOYMENT_HISTORY_FIELD_LABELS: Record<string, string> = {
  company_id: "Company",
  site_id: "Site",
  department_id: "Department",
  designation_id: "Designation",
  reporting_manager_id: "Reporting Manager",
  employment_type: "Employee Type",
  shift: "Shift",
  status: "Status",
  date_of_joining: "Joining Date",
  confirmation_date: "Confirmation Date",
  notice_period_from: "Notice Period From",
  notice_period_to: "Notice Period To",
  resignation_date: "Resignation Date",
  date_of_exit: "Relieving Date",
  exit_remark: "Exit Remark",
};

export const EMPLOYMENT_HISTORY_FIELDS = Object.keys(EMPLOYMENT_HISTORY_FIELD_LABELS);

export function employmentEventLabel(eventType?: string | null) {
  return employmentHistoryEventLabels.get(eventType as EmploymentHistoryEventType) || "Employment Event";
}

function normalizeValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function valuesDiffer(left: unknown, right: unknown) {
  return normalizeValue(left) !== normalizeValue(right);
}

export function mapEmploymentEventType(field: string, previousValue: unknown, newValue: unknown): EmploymentHistoryEventType {
  if (field === "confirmation_date") return "confirmed";
  if (field === "company_id") return "company_changed";
  if (field === "site_id") return "site_changed";
  if (field === "department_id") return "department_changed";
  if (field === "designation_id") return "designation_changed";
  if (field === "reporting_manager_id") return "reporting_manager_changed";
  if (field === "employment_type") return "employee_type_changed";
  if (field === "shift") return "shift_changed";
  if (field === "resignation_date") return "resigned";
  if (field === "date_of_exit") return "relieved";

  if (field === "status") {
    const previousStatus = normalizeValue(previousValue);
    const nextStatus = normalizeValue(newValue);
    if (nextStatus === "suspended") return "suspended";
    if (previousStatus === "suspended" && nextStatus === "active") return "reinstated";
    return "status_changed";
  }

  return "correction";
}

export function eventDateForField(field: string, value: unknown, fallback: string) {
  if (["date_of_joining", "confirmation_date", "resignation_date", "date_of_exit"].includes(field)) {
    return normalizeValue(value) || fallback;
  }
  return fallback;
}
