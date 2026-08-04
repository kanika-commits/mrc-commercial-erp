export const PERMISSION_ACTIONS = [
  "view",
  "add",
  "edit",
  "delete",
  "approve",
  "reject",
  "upload",
  "submit",
  "execute",
  "mark_paid",
  "export",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

const MODULE_ACTIONS: Record<string, PermissionAction[]> = {
  dashboard: ["view"],
  reports: ["view", "export"],

  organizations: ["view", "add", "edit", "delete"],
  users: ["view", "add", "edit", "delete"],
  roles: ["view", "add", "edit"],
  permissions: ["view", "edit"],

  companies: ["view", "add", "edit", "delete"],
  sites: ["view", "add", "edit", "delete"],
  vendors: ["view", "add", "edit", "delete"],
  company_bank_accounts: ["view", "add", "edit", "delete"],

  work_orders: ["view", "add", "edit", "delete", "export"],
  wo_approval: ["view", "edit", "approve", "reject", "upload"],
  ra_bills: ["view", "add", "delete"],
  ra_approval: ["view", "approve", "reject"],
  invoices: ["view", "add", "delete"],
  itc_claims: ["view", "approve", "delete"],
  payments: ["view", "add", "delete"],
  debit_notes: ["view", "add", "delete"],

  hr_employees: ["view", "add", "edit", "delete"],
  hr_departments: ["view", "add", "edit", "delete"],
  hr_designations: ["view", "add", "edit", "delete"],
  hr_employee_import: ["view", "upload", "execute", "export"],
  hr_audit: ["view"],
  hr_salary: ["view", "add", "edit", "delete"],
  reimbursements: [
    "view",
    "add",
    "edit",
    "delete",
    "upload",
    "submit",
    "approve",
    "reject",
    "mark_paid",
  ],
};

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  add: "Add",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  reject: "Reject",
  upload: "Upload",
  submit: "Submit",
  execute: "Execute",
  mark_paid: "Mark Paid",
  export: "Export",
};

export function permissionActionLabel(actionCode: string) {
  return ACTION_LABELS[actionCode] || actionCode;
}

export function availableActionsForModule(moduleCode: string): PermissionAction[] {
  return MODULE_ACTIONS[moduleCode] || ["view"];
}

export function isValidPermissionAction(moduleCode: string, actionCode: string) {
  return availableActionsForModule(moduleCode).includes(actionCode as PermissionAction);
}
