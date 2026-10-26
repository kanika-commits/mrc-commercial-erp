export const EMPLOYEE_COLUMNS = [
  "employee_code", "employee_name", "company", "site", "department", "designation", "reporting_manager",
  "email", "phone", "personal_email", "personal_phone", "date_of_joining", "confirmation_date", "notice_period_from", "notice_period_to", "resignation_date", "date_of_exit", "employment_type", "shift", "status", "exit_remark", "remarks",
  "date_of_birth", "gender", "nationality", "blood_group", "marital_status", "father_name", "mother_name", "spouse_name", "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
  "current_address", "current_address_line1", "current_address_line2", "current_address_city", "current_address_state", "current_address_country", "current_address_pin_code", "permanent_address", "permanent_address_line1", "permanent_address_line2", "permanent_address_city", "permanent_address_state", "permanent_address_country", "permanent_address_pin_code",
] as const;
export type EmployeeColumn = (typeof EMPLOYEE_COLUMNS)[number];
export const DEFAULT_EMPLOYEE_COLUMNS: EmployeeColumn[] = ["employee_code", "employee_name", "company", "site", "department", "designation", "reporting_manager", "email", "phone", "date_of_joining", "confirmation_date", "notice_period_from", "notice_period_to", "resignation_date", "date_of_exit", "employment_type", "shift", "status"];
export function normalizeEmployeeColumns(input: string[] | null | undefined): EmployeeColumn[] {
  const requested = new Set(input || []);
  return EMPLOYEE_COLUMNS.filter((column) => requested.has(column));
}
