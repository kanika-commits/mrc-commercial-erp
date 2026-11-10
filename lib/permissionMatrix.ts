// Keep permission-module identifiers in the permission registry so the registry
// does not depend on optional Finance feature files.
export const FINANCE_MODULES = {
  controlCentre: "finance_dashboard",
  bankGuarantees: "finance_bg",
  fdr: "finance_fdr",
  insurance: "finance_insurance",
  tenderEmd: "finance_tender_emd",
  bankingLimits: "finance_banking_limits",
} as const;

export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "add",
  "edit",
  "issue",
  "delete",
  "hard_delete",
  "approve",
  "reject",
  "suspend",
  "resume",
  "upload",
  "import",
  "submit",
  "pm_approve",
  "pm_send_back",
  "ho_approve",
  "ho_send_back",
  "final_override",
  "assign_engineer",
  "edit_site_responsibility",
  "edit_attendance_policy",
  "assign_override_authority",
  "change_deployment",
  "change_rate",
  "execute",
  "correct_time",
  "override",
  "mark_paid",
  "export",
  "take_up",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  add: "Add",
  edit: "Edit",
  issue: "Issue",
  delete: "Delete",
  hard_delete: "Permanent Delete",
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  resume: "Resume",
  upload: "Upload",
  import: "Import",
  submit: "Submit",
  pm_approve: "PM Approve",
  pm_send_back: "PM Send Back",
  ho_approve: "HO HR Final Approve",
  ho_send_back: "HO HR Send Back",
  final_override: "Final Override",
  assign_engineer: "Assign Engineer",
  edit_site_responsibility: "Edit Site Responsibility",
  edit_attendance_policy: "Edit Attendance Policy",
  assign_override_authority: "Assign Override Authority",
  change_deployment: "Change Deployment",
  change_rate: "Change Rate",
  execute: "Execute",
  correct_time: "Correct Site-In Time",
  override: "Override",
  mark_paid: "Mark Paid",
  export: "Export",
  take_up: "Take Up",
};

const MODULE_ACTIONS: Record<string, PermissionAction[]> = {
  dashboard: ["view"],
  reports: ["view"],

  organizations: ["view", "add", "edit", "delete"],
  users: ["view", "add", "edit", "delete"],
  roles: ["view", "add", "edit"],
  permissions: ["view", "edit"],

  companies: ["view", "add", "edit", "delete"],
  sites: ["view", "add", "edit", "delete"],
  vendors: ["view", "add", "edit", "delete"],
  company_bank_accounts: ["view", "add", "edit", "delete"],
  procurement_items: ["view", "add", "edit", "delete", "export"],
  procurement_purchase_queue: ["view", "take_up"],

  work_orders: ["view", "add", "edit", "delete", "export"],
  wo_approval: ["view", "edit", "approve", "reject", "upload"],
  purchase_requisitions: ["view", "add", "edit", "delete", "submit", "export"],
  purchase_requisition_approval: ["view", "approve", "reject"],
  purchase_requisition_approval_configuration: ["view", "edit"],
  procurement_rfqs: ["view", "add", "edit", "delete", "issue", "export"],
  procurement_purchase_orders: ["view", "add", "edit", "approve", "reject", "export"],
  procurement_gst_billing_delivery_master: ["view", "add", "edit"],
  procurement_site_contact_master: ["view", "add", "edit"],
  procurement_letterhead_master: ["view", "add", "edit", "delete"],
  procurement_po_terms_master: ["view", "add", "edit"],
  procurement_goods_receipts: ["view", "add", "edit", "approve", "export"],
  procurement_inventory: ["view", "add", "edit", "approve", "export"],
  procurement_material_approvals: ["view", "add", "edit", "delete", "upload"],
  ra_bills: ["view", "add", "delete"],
  ra_approval: ["view", "approve", "reject"],
  invoices: ["view", "add", "delete"],
  itc_claims: ["view", "approve", "delete"],
  payments: ["view", "add", "delete"],
  debit_notes: ["view", "add", "delete"],
  credit_notes: ["view", "add", "edit", "delete", "approve", "reject", "export"],
  [FINANCE_MODULES.controlCentre]: ["view"],
  [FINANCE_MODULES.bankGuarantees]: ["view", "create", "edit", "delete", "upload"],
  [FINANCE_MODULES.fdr]: ["view"],
  [FINANCE_MODULES.insurance]: ["view"],
  [FINANCE_MODULES.tenderEmd]: ["view"],
  [FINANCE_MODULES.bankingLimits]: ["view"],

  hr_employees: ["view", "add", "edit", "delete"],
  hr_departments: ["view", "add", "edit", "delete"],
  hr_designations: ["view", "add", "edit", "delete"],
  hr_attendance: ["view", "add", "edit", "submit", "override", "export"],
  hr_attendance_register: ["view"],
  hr_attendance_approval: ["view", "approve", "reject"],
  hr_employee_attendance_policy: ["view", "add", "edit"],
  hr_employee_import: ["view", "upload", "execute", "export"],
  hr_employee_document_import: ["view", "upload", "execute", "export"],
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
  labour_contractors: ["view", "add", "edit", "delete", "upload", "export"],
  labour_workers: ["view", "add", "edit", "delete", "hard_delete", "upload", "import", "export", "change_deployment", "change_rate"],
  labour_deployments: ["view", "add", "edit", "export"],
  labour_import: ["view", "upload", "execute", "export"],
  labour_documents: ["view", "upload", "delete"],
  labour_trades: ["view", "add", "edit", "delete", "export"],
  labour_attendance: ["view", "add", "edit", "submit", "override", "export"],
  labour_attendance_approval: ["view", "approve"],
  labour_attendance_import: ["view", "upload", "execute", "export"],
  labour_wage_rates: ["view", "add", "edit", "delete", "export"],
  labour_wages: ["view", "add", "edit", "submit", "export"],
  labour_wage_approval: ["view", "approve", "reject"],
  labour_advances: ["view", "add", "edit", "delete", "approve", "export"],
  labour_manpower_work_orders: ["view", "add", "edit", "delete", "submit", "approve", "reject", "suspend", "resume", "upload", "export"],
  labour_attendance_policy: ["view", "edit", "override"],
  labour_attendance_unlock: ["view", "approve"],
  labour_site_in: ["view", "add", "correct_time"],
  labour_engineer_daily: ["view", "add", "edit", "submit"],
  labour_muster_configuration: ["view", "edit_site_responsibility", "edit_attendance_policy", "assign_override_authority", "export"],
  labour_engineer_groups: ["view", "create", "edit", "delete"],
  labour_work_groups: ["view", "add", "edit", "delete", "submit", "approve", "export"],
  labour_work_logs: ["view", "add", "edit", "delete", "submit", "approve", "reject", "assign_engineer", "upload", "export"],
  labour_daily_submission: ["view", "submit", "pm_approve", "pm_send_back", "ho_approve", "ho_send_back", "final_override", "export"],
  labour_overtime: ["view", "add", "edit", "approve", "reject", "export"],
  labour_photo_evidence: ["view", "upload", "edit", "delete"],
  labour_rate_overrides: ["view", "add", "edit", "delete", "approve", "export"],
};

// Product entitlements are intentionally broader than the permission modules
// checked by individual pages and APIs.
export const ENTITLEMENT_PERMISSION_MODULES: Record<string, string[]> = {
  dashboard: ["dashboard"],
  administration: ["organizations", "users", "roles", "permissions", "companies", "sites", "vendors", "company_bank_accounts"],
  hr: ["hr_employees", "hr_departments", "hr_designations", "hr_attendance", "hr_attendance_register", "hr_attendance_approval", "hr_employee_attendance_policy", "hr_employee_import", "hr_employee_document_import", "hr_audit", "hr_salary", "reimbursements"],
  labour: ["labour_contractors", "labour_workers", "labour_deployments", "labour_import", "labour_documents", "labour_trades", "labour_attendance", "labour_attendance_approval", "labour_attendance_import", "labour_wage_rates", "labour_wages", "labour_wage_approval", "labour_advances", "labour_manpower_work_orders", "labour_attendance_policy", "labour_attendance_unlock", "labour_site_in", "labour_engineer_daily", "labour_muster_configuration", "labour_engineer_groups", "labour_work_groups", "labour_work_logs", "labour_daily_submission", "labour_overtime", "labour_photo_evidence", "labour_rate_overrides"],
  purchase: ["procurement_items", "procurement_purchase_queue", "purchase_requisitions", "purchase_requisition_approval", "procurement_rfqs", "procurement_purchase_orders", "procurement_gst_billing_delivery_master", "procurement_site_contact_master", "procurement_letterhead_master", "procurement_po_terms_master"],
  store: ["procurement_goods_receipts", "procurement_inventory"],
  commercial: ["ra_bills", "ra_approval", "invoices", "itc_claims", "payments", "debit_notes", "credit_notes"],
  accounts: ["ra_bills", "ra_approval", "invoices", "itc_claims", "payments", "debit_notes", "credit_notes", FINANCE_MODULES.controlCentre, FINANCE_MODULES.bankGuarantees, FINANCE_MODULES.fdr, FINANCE_MODULES.insurance, FINANCE_MODULES.tenderEmd, FINANCE_MODULES.bankingLimits],
  reports: ["reports"],
};

export function permissionModulesForEntitlements(entitlementCodes: string[]) {
  return Array.from(new Set(entitlementCodes.flatMap((code) => ENTITLEMENT_PERMISSION_MODULES[code] || [])));
}

export function permissionActionLabel(actionCode: string) {
  return ACTION_LABELS[actionCode as PermissionAction] || actionCode;
}

export function availableActionsForModule(moduleCode: string): PermissionAction[] {
  return MODULE_ACTIONS[moduleCode] || ["view"];
}

export function isValidPermissionAction(moduleCode: string, actionCode: string) {
  return availableActionsForModule(moduleCode).includes(actionCode as PermissionAction);
}
