export const SALARY_REVISION_TYPES = [
  { code: "joining_salary", label: "Joining Salary" },
  { code: "annual_increment", label: "Annual Increment" },
  { code: "promotion_revision", label: "Promotion Revision" },
  { code: "salary_correction", label: "Salary Correction" },
  { code: "special_revision", label: "Special Revision" },
  { code: "retention_revision", label: "Retention Revision" },
  { code: "market_adjustment", label: "Market Adjustment" },
  { code: "other", label: "Other" },
] as const;

export type SalaryRevisionType = (typeof SALARY_REVISION_TYPES)[number]["code"];

export const SALARY_AMOUNT_FIELDS = [
  "basic_salary",
  "gross_salary",
  "net_salary",
  "ctc",
  "employee_pf",
  "employer_pf",
  "employee_esic",
  "employer_esic",
  "professional_tax",
  "tds",
  "other_salary_deductions",
  "bonus",
] as const;

export type SalaryAmountField = (typeof SALARY_AMOUNT_FIELDS)[number];

export const SALARY_FIELD_LABELS: Record<SalaryAmountField, string> = {
  basic_salary: "Basic Salary",
  gross_salary: "Gross Salary",
  net_salary: "Net Salary",
  ctc: "CTC",
  employee_pf: "Employee PF",
  employer_pf: "Employer PF",
  employee_esic: "Employee ESIC",
  employer_esic: "Employer ESIC",
  professional_tax: "Professional Tax",
  tds: "TDS",
  other_salary_deductions: "Other Salary Deductions",
  bonus: "Bonus",
};

export function salaryRevisionLabel(value?: string | null) {
  return SALARY_REVISION_TYPES.find((type) => type.code === value)?.label || "Salary Revision";
}

export function parseSalaryAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error("Salary amounts must be numeric.");
  }
  if (amount < 0) {
    throw new Error("Salary amounts cannot be negative.");
  }
  return Math.round(amount * 100) / 100;
}
