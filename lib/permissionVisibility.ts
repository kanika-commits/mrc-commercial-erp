import { availableActionsForModule } from "@/lib/permissionMatrix";

const HIDDEN_PERMISSION_MODULES = new Set([
  "labour_import",
  "labour_engineer_groups",
  "labour_wage_approval",
  "store_management",
  "support",
  "settings_password",
  "labour_workspace",
  "procurement_material_approvals",
]);

const VISIBLE_GROUP_ORDER = [
  "Dashboard",
  "Project Management",
  "Human Resources",
  "Labour Management",
  "Purchase",
  "Accounts / Finance",
  "Reports",
  "Settings",
  "Admin",
] as const;

type VisiblePermissionPresentation = {
  visible_group: string;
  visible_name: string;
  visible_sort_order: number;
  visible_actions?: string[];
  visible_action_labels?: Record<string, string>;
  permission_note?: string | null;
};

type PresentedPermissionModule<T extends PermissionModuleRow> = T & {
  module_group: string;
  module_name: string;
  sort_order: number;
  permission_note: string | null;
  technical_group: string | null;
  permission_module_code?: string;
  display_only?: boolean;
  visible_actions?: string[] | null;
};

const SPECIALIZED_PERMISSION_ACTIONS = new Set([
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
  "correct_time",
  "mark_paid",
  "take_up",
]);

type PresentedModuleInput = PermissionModuleRow & {
  permission_module_code?: string | null;
  visible_actions?: string[] | null;
};

export function normalPermissionActions(module: PresentedModuleInput): string[] {
  const actions = Array.isArray(module.visible_actions)
    ? module.visible_actions
    : availableActionsForModule(String(module.permission_module_code || module.module_code || ""));
  return actions.filter((action) => !SPECIALIZED_PERMISSION_ACTIONS.has(action));
}

export function specializedPermissionActions(module: PresentedModuleInput): string[] {
  const actions = Array.isArray(module.visible_actions)
    ? module.visible_actions
    : availableActionsForModule(String(module.permission_module_code || module.module_code || ""));
  return actions.filter((action) => SPECIALIZED_PERMISSION_ACTIONS.has(action));
}

const PERMISSION_PRESENTATION: Record<string, VisiblePermissionPresentation> = {
  dashboard: { visible_group: "Dashboard", visible_name: "Dashboard", visible_sort_order: 1 },

  ra_bills: { visible_group: "Project Management", visible_name: "RA Bills", visible_sort_order: 10 },
  debit_notes: { visible_group: "Project Management", visible_name: "Debit Notes", visible_sort_order: 20 },
  ra_approval: { visible_group: "Project Management", visible_name: "RA Bills / Debit Note Approvals", visible_sort_order: 30 },

  purchase_requisitions: { visible_group: "Store Management", visible_name: "Material Indent", visible_sort_order: 5, visible_actions: ["view", "add", "edit", "delete", "submit", "export"] },
  purchase_requisition_approval: { visible_group: "Store Management", visible_name: "Indent Approval", visible_sort_order: 6, visible_actions: ["view", "approve", "reject"], visible_action_labels: { reject: "Send Back / Reject" } },
  procurement_goods_receipts: { visible_group: "Store Management", visible_name: "Purchase Order Tracking", visible_sort_order: 7, visible_actions: ["view", "add", "edit", "approve", "export"], visible_action_labels: { approve: "Finalize" } },
  procurement_inventory: { visible_group: "Store Management", visible_name: "Inventory", visible_sort_order: 8, visible_actions: ["view", "add", "edit", "approve", "export"], visible_action_labels: { approve: "Finalize Issue" } },
  procurement_rfqs: { visible_group: "Purchase", visible_name: "Request for Quotation", visible_sort_order: 7, visible_actions: ["view", "add", "edit", "delete", "issue", "export"] },
  procurement_purchase_queue: { visible_group: "Purchase", visible_name: "Purchase Queue", visible_sort_order: 6.5, visible_actions: ["view", "take_up"] },
  procurement_purchase_orders: { visible_group: "Purchase", visible_name: "Purchase Orders", visible_sort_order: 8, visible_actions: ["view", "add", "edit", "approve", "reject", "export"] },
  work_orders: { visible_group: "Purchase", visible_name: "Work Orders", visible_sort_order: 10 },
  wo_approval: { visible_group: "Purchase", visible_name: "Work Order Approval", visible_sort_order: 20 },

  invoices: { visible_group: "Accounts / Finance", visible_name: "Invoices", visible_sort_order: 10 },
  itc_claims: { visible_group: "Accounts / Finance", visible_name: "ITC Review", visible_sort_order: 20 },
  payments: { visible_group: "Accounts / Finance", visible_name: "Payments", visible_sort_order: 30 },

  reports: {
    visible_group: "Reports",
    visible_name: "Reports",
    visible_sort_order: 10,
    visible_actions: ["view", "export"],
  },

  hr_employees: {
    visible_group: "Human Resources",
    visible_name: "Employee Registration",
    visible_sort_order: 10,
  },
  hr_employee_import: {
    visible_group: "Human Resources",
    visible_name: "Employee Import",
    visible_sort_order: 11,
    visible_actions: ["view", "upload", "execute", "export"],
  },
  hr_employee_document_import: {
    visible_group: "Human Resources",
    visible_name: "Employee Document Import",
    visible_sort_order: 12,
    visible_actions: ["view", "upload", "execute", "export"],
  },
  hr_attendance: {
    visible_group: "Human Resources",
    visible_name: "Attendance",
    visible_sort_order: 20,
    visible_actions: ["view", "add", "edit", "submit", "override", "export"],
  },
  hr_attendance_register: {
    visible_group: "Human Resources",
    visible_name: "Attendance Register",
    visible_sort_order: 25,
    visible_actions: ["view"],
  },
  hr_attendance_approval: {
    visible_group: "Human Resources",
    visible_name: "Attendance Approval",
    visible_sort_order: 30,
    visible_actions: ["view", "approve", "reject"],
    visible_action_labels: { approve: "Approve", reject: "Send Back" },
  },
  reimbursements: { visible_group: "Human Resources", visible_name: "Reimbursement", visible_sort_order: 50 },
  hr_salary: {
    visible_group: "Human Resources",
    visible_name: "Salary / Remuneration",
    visible_sort_order: 52,
    permission_note: "Controls access to employee salary and remuneration information.",
  },
  hr_audit: {
    visible_group: "Human Resources",
    visible_name: "HR Audit",
    visible_sort_order: 54,
    visible_actions: ["view"],
    permission_note: "Controls access to sensitive HR audit and activity information.",
  },
  labour_attendance: {
    visible_group: "Labour Management",
    visible_name: "Labour Attendance",
    visible_sort_order: 60,
    visible_actions: ["view", "add", "edit", "submit", "override", "export"],
  },
  labour_attendance_import: {
    visible_group: "Labour Management",
    visible_name: "Labour Attendance Import",
    visible_sort_order: 65,
    visible_actions: ["view", "upload", "execute", "export"],
  },
  labour_workers: {
    visible_group: "Labour Management",
    visible_name: "Labour Registration",
    visible_sort_order: 70,
    visible_actions: ["view", "add", "edit", "delete", "upload", "import", "export", "change_deployment", "change_rate"],
  },
  labour_contractors: {
    visible_group: "Labour Management",
    visible_name: "Labour Contractors",
    visible_sort_order: 72,
    permission_note: "Controls contractor master access and contractor document upload/export actions.",
  },
  labour_deployments: {
    visible_group: "Labour Management",
    visible_name: "Labour Deployments",
    visible_sort_order: 74,
    permission_note: "Controls worker deployment records where exposed by Labour workflows.",
  },
  labour_documents: {
    visible_group: "Labour Management",
    visible_name: "Labour Documents",
    visible_sort_order: 76,
    visible_actions: ["view", "upload", "delete"],
    permission_note: "Controls labour and contractor document viewing, upload and deletion.",
  },
  labour_site_in: {
    visible_group: "Labour Management",
    visible_name: "Site-In",
    visible_sort_order: 80,
    visible_actions: ["view", "add", "correct_time"],
  },
  labour_engineer_daily: {
    visible_group: "Labour Management",
    visible_name: "Engineer Daily Labour",
    visible_sort_order: 90,
    visible_actions: ["view", "add", "edit", "submit"],
  },
  labour_daily_submission: {
    visible_group: "Labour Management",
    visible_name: "Labour Attendance Approval",
    visible_sort_order: 100,
    visible_actions: ["view", "pm_approve", "pm_send_back", "ho_approve", "ho_send_back", "final_override", "export"],
    permission_note: "View includes register review and supporting attendance document viewing.",
  },
  labour_manpower_work_orders: {
    visible_group: "Labour Management",
    visible_name: "Manpower Work Orders",
    visible_sort_order: 110,
    permission_note: "Controls labour manpower contract workflow actions.",
  },
  labour_wages: {
    visible_group: "Labour Management",
    visible_name: "Wage Register",
    visible_sort_order: 120,
    permission_note: "Controls labour wage calculation, editing, submission and export.",
  },
  labour_wage_rates: {
    visible_group: "Labour Management",
    visible_name: "Wage Rates",
    visible_sort_order: 122,
    permission_note: "Controls wage-rate master access where exposed by Labour workflows.",
  },
  labour_advances: {
    visible_group: "Labour Management",
    visible_name: "Labour Advances",
    visible_sort_order: 130,
    permission_note: "Controls labour advance entry, approval and export.",
  },
  labour_work_logs: {
    visible_group: "Labour Management",
    visible_name: "Daily Work Logs",
    visible_sort_order: 140,
    permission_note: "Controls labour work log entry, approval, assignment and document upload.",
  },
  labour_work_groups: {
    visible_group: "Labour Management",
    visible_name: "Work Groups",
    visible_sort_order: 142,
    permission_note: "Controls labour work-group setup and approval actions.",
  },
  labour_overtime: {
    visible_group: "Labour Management",
    visible_name: "Overtime Review",
    visible_sort_order: 150,
    permission_note: "Controls labour overtime requests and approvals.",
  },
  labour_rate_overrides: {
    visible_group: "Labour Management",
    visible_name: "Rate Overrides",
    visible_sort_order: 152,
    permission_note: "Controls labour rate override requests and approvals.",
  },
  labour_photo_evidence: {
    visible_group: "Labour Management",
    visible_name: "Photo Evidence",
    visible_sort_order: 154,
    permission_note: "Controls labour photo evidence viewing, upload, edit and deletion.",
  },
  labour_attendance_policy: {
    visible_group: "Labour Management",
    visible_name: "Attendance Policy Controls",
    visible_sort_order: 160,
    permission_note: "Controls Labour Attendance policy and configuration actions.",
  },
  labour_attendance_unlock: {
    visible_group: "Labour Management",
    visible_name: "Attendance Date Access",
    visible_sort_order: 162,
    visible_actions: ["view", "approve"],
    visible_action_labels: { approve: "Open / Approve Access" },
    permission_note: "Controls Attendance Date Access and unlock-authority functionality.",
  },

  companies: { visible_group: "Settings", visible_name: "Masters - Companies", visible_sort_order: 10 },
  sites: { visible_group: "Settings", visible_name: "Masters - Sites", visible_sort_order: 20 },
  vendors: { visible_group: "Settings", visible_name: "Masters - Vendors", visible_sort_order: 30 },
  hr_departments: { visible_group: "Settings", visible_name: "Masters - Departments", visible_sort_order: 40 },
  hr_designations: { visible_group: "Settings", visible_name: "Masters - Designations", visible_sort_order: 50 },
  labour_trades: { visible_group: "Settings", visible_name: "Masters - Labour Categories", visible_sort_order: 60 },
  company_bank_accounts: { visible_group: "Settings", visible_name: "Masters - Bank Accounts", visible_sort_order: 70 },
  procurement_items: { visible_group: "Settings", visible_name: "Masters - Item / Material Master", visible_sort_order: 75 },
  hr_employee_attendance_policy: { visible_group: "Settings", visible_name: "Policies - Employee Attendance Policy", visible_sort_order: 80 },
  labour_muster_configuration: { visible_group: "Settings", visible_name: "Policies - Labour Attendance Policy", visible_sort_order: 90 },

  organizations: { visible_group: "Admin", visible_name: "Organizations", visible_sort_order: 10 },
  users: { visible_group: "Admin", visible_name: "Users", visible_sort_order: 20 },
  roles: { visible_group: "Admin", visible_name: "Roles", visible_sort_order: 30 },
  permissions: { visible_group: "Admin", visible_name: "Permissions", visible_sort_order: 40 },
  system_activity: {
    visible_group: "Admin",
    visible_name: "System Activity",
    visible_sort_order: 50,
    visible_actions: ["view"],
    permission_note: "Controls access to system activity and audit pages.",
  },
};

const FALLBACK_GROUP_LABELS: Record<string, VisiblePermissionPresentation["visible_group"]> = {
  dashboard: "Dashboard",
  project_management: "Project Management",
  store_management: "Store Management",
  hr: "Human Resources",
  purchase: "Purchase",
  accounts: "Accounts / Finance",
  settings: "Settings",
  administration: "Admin",
};

type PermissionModuleRow = {
  module_code?: string | null;
  module_group?: string | null;
  module_name?: string | null;
  sort_order?: number | null;
  status?: string | null;
};

export function isVisiblePermissionModule(module: PermissionModuleRow) {
  const moduleCode = String(module.module_code || "").trim();
  if (!moduleCode) return false;
  if (HIDDEN_PERMISSION_MODULES.has(moduleCode)) return false;
  if (!PERMISSION_PRESENTATION[moduleCode]) return false;
  if (module.status && module.status !== "active") return false;
  return true;
}

export function filterVisiblePermissionModules<T extends PermissionModuleRow>(modules: T[]) {
  return modules.filter(isVisiblePermissionModule);
}

export function visiblePermissionGroupOrder(groupName: string) {
  const index = VISIBLE_GROUP_ORDER.indexOf(groupName as any);
  return index === -1 ? VISIBLE_GROUP_ORDER.length : index;
}

export function presentVisiblePermissionModule<T extends PermissionModuleRow>(module: T) {
  const moduleCode = String(module.module_code || "").trim();
  const presentation = PERMISSION_PRESENTATION[moduleCode];
  const visibleGroup =
    presentation?.visible_group ||
    FALLBACK_GROUP_LABELS[String(module.module_group || "").trim()] ||
    "Admin";

  return {
    ...module,
    module_group: visibleGroup,
    module_name: presentation?.visible_name || module.module_name || moduleCode,
    sort_order: presentation?.visible_sort_order ?? Number(module.sort_order || 0),
    permission_note: presentation?.permission_note || null,
    technical_group: module.module_group || null,
    visible_actions: presentation?.visible_actions || null,
    visible_action_labels: presentation?.visible_action_labels || null,
  };
}

export function prepareVisiblePermissionModules<T extends PermissionModuleRow>(modules: T[]) {
  const registryModules = [...modules];
  if (!registryModules.some((module) => module.module_code === "procurement_goods_receipts")) {
    registryModules.push({ module_code: "procurement_goods_receipts", module_group: "store_management", module_name: "Purchase Order Tracking", sort_order: 7, status: "active" } as T);
  }
  if (!registryModules.some((module) => module.module_code === "procurement_inventory")) {
    registryModules.push({ module_code: "procurement_inventory", module_group: "store_management", module_name: "Inventory", sort_order: 8, status: "active" } as T);
  }
  if (!registryModules.some((module) => module.module_code === "procurement_purchase_orders")) {
    registryModules.push({ module_code: "procurement_purchase_orders", module_group: "purchase", module_name: "Purchase Orders", sort_order: 8, status: "active" } as T);
  }
  const visibleModules = filterVisiblePermissionModules(registryModules)
    .map(presentVisiblePermissionModule);

  const purchaseOrders = visibleModules.find((module) => module.module_code === "procurement_purchase_orders");
  if (purchaseOrders && !visibleModules.some((module) => module.module_code === "procurement_purchase_order_approval")) {
    visibleModules.push({ ...purchaseOrders, id: "presentation-procurement-purchase-order-approval", module_code: "procurement_purchase_order_approval", permission_module_code: "procurement_purchase_orders", module_name: "Purchase Order Approval", sort_order: 9, visible_actions: ["view", "approve", "reject"] } as typeof purchaseOrders);
  }

  return visibleModules
    .sort((a, b) => {
      const groupOrder =
        visiblePermissionGroupOrder(String(a.module_group || "")) -
        visiblePermissionGroupOrder(String(b.module_group || ""));
      if (groupOrder !== 0) return groupOrder;
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    }) as PresentedPermissionModule<T>[];
}
