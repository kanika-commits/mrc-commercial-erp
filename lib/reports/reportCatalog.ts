export type ReportCategory = "commercial" | "hr" | "labour";

export type ReportDataset = {
  code: string;
  title: string;
  description: string;
  category: ReportCategory;
  sourceModule: string;
  requiredAction: "view";
};

export type StandardReportTemplate = {
  code: string;
  title: string;
  description: string;
  datasetCode: string;
};

export const REPORT_CATEGORIES: Record<
  ReportCategory,
  { title: string; description: string }
> = {
  commercial: {
    title: "Commercial",
    description: "Work Orders, RA Bills, invoices, payments, debit notes and vendors.",
  },
  hr: {
    title: "HR",
    description: "Employees, attendance and reimbursements.",
  },
  labour: {
    title: "Labour",
    description: "Labour workers, contractors, trades and labour attendance.",
  },
};

export const REPORT_DATASETS: ReportDataset[] = [
  {
    code: "work_orders",
    title: "Work Orders",
    description: "Build reports from Work Order register fields.",
    category: "commercial",
    sourceModule: "work_orders",
    requiredAction: "view",
  },
  {
    code: "ra_bills",
    title: "RA Bills",
    description: "Build reports from RA Bill register fields.",
    category: "commercial",
    sourceModule: "ra_bills",
    requiredAction: "view",
  },
  {
    code: "invoices",
    title: "Invoices",
    description: "Build reports from invoice register fields.",
    category: "commercial",
    sourceModule: "invoices",
    requiredAction: "view",
  },
  {
    code: "payments",
    title: "Payments",
    description: "Build reports from payment register fields.",
    category: "commercial",
    sourceModule: "payments",
    requiredAction: "view",
  },
  {
    code: "debit_notes",
    title: "Debit Notes",
    description: "Build reports from debit note records.",
    category: "commercial",
    sourceModule: "debit_notes",
    requiredAction: "view",
  },
  {
    code: "vendors",
    title: "Vendors",
    description: "Build reports from vendor master data.",
    category: "commercial",
    sourceModule: "vendors",
    requiredAction: "view",
  },
  {
    code: "employees",
    title: "Employees",
    description: "Build reports from employee master records.",
    category: "hr",
    sourceModule: "hr_employees",
    requiredAction: "view",
  },
  {
    code: "employee_attendance",
    title: "Employee Attendance",
    description: "Build reports from monthly employee attendance records.",
    category: "hr",
    sourceModule: "hr_attendance",
    requiredAction: "view",
  },
  {
    code: "reimbursements",
    title: "Reimbursements",
    description: "Build reports from reimbursement claims.",
    category: "hr",
    sourceModule: "reimbursements",
    requiredAction: "view",
  },
  {
    code: "labour_workers",
    title: "Labour Workers",
    description: "Build reports from labour registration and deployment fields.",
    category: "labour",
    sourceModule: "labour_workers",
    requiredAction: "view",
  },
  {
    code: "labour_attendance",
    title: "Labour Attendance",
    description: "Build reports from labour attendance register data.",
    category: "labour",
    sourceModule: "labour_attendance",
    requiredAction: "view",
  },
];

export const STANDARD_REPORT_TEMPLATES: StandardReportTemplate[] = [
  {
    code: "work_order_register",
    title: "Work Order Register",
    description: "A predefined register based on the Work Orders dataset.",
    datasetCode: "work_orders",
  },
  {
    code: "payment_register",
    title: "Payment Register",
    description: "A predefined register based on the Payments dataset.",
    datasetCode: "payments",
  },
  {
    code: "employee_register",
    title: "Employee Register",
    description: "A predefined register based on the Employees dataset.",
    datasetCode: "employees",
  },
  {
    code: "labour_attendance_register",
    title: "Labour Attendance Register",
    description: "A predefined register based on the Labour Attendance dataset.",
    datasetCode: "labour_attendance",
  },
];
