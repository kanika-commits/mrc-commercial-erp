export type ReleasedModuleGroup =
  | "dashboard"
  | "project_management"
  | "purchase"
  | "accounts"
  | "settings"
  | "hr"
  | "administration";

export type ReleasedModuleItem = {
  code: string;
  title: string;
  route: string;
  group: ReleasedModuleGroup;
  permissionModule: string;
  requiredAction: "view";
  sidebar: boolean;
  launcher: boolean;
  permissionMatrix: boolean;
  sortOrder: number;
};

export type ReleasedModuleGroupItem = {
  code: ReleasedModuleGroup;
  title: string;
  route: string;
  sortOrder: number;
  sidebar: boolean;
  launcher: boolean;
};

export const RELEASED_GROUPS: ReleasedModuleGroupItem[] = [
  { code: "dashboard", title: "Dashboard", route: "/", sortOrder: 1, sidebar: true, launcher: false },
  { code: "project_management", title: "Project Management", route: "/modules/project-management", sortOrder: 10, sidebar: true, launcher: true },
  { code: "purchase", title: "Purchase", route: "/modules/purchase", sortOrder: 20, sidebar: true, launcher: true },
  { code: "accounts", title: "Accounts / Finance", route: "/modules/accounts", sortOrder: 30, sidebar: true, launcher: true },
  { code: "hr", title: "Human Resources", route: "/modules/hr", sortOrder: 40, sidebar: true, launcher: true },
  { code: "settings", title: "Settings", route: "/modules/settings", sortOrder: 50, sidebar: true, launcher: true },
  { code: "administration", title: "Administration", route: "/modules/administration", sortOrder: 60, sidebar: true, launcher: true },
];

export const RELEASED_MODULES: ReleasedModuleItem[] = [
  { code: "dashboard", title: "Dashboard", route: "/", group: "dashboard", permissionModule: "dashboard", requiredAction: "view", sidebar: true, launcher: false, permissionMatrix: true, sortOrder: 1 },

  { code: "ra_bills", title: "RA Bills", route: "/ra-bills", group: "project_management", permissionModule: "ra_bills", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "debit_notes", title: "Debit Notes", route: "/debit-notes", group: "project_management", permissionModule: "debit_notes", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },
  { code: "ra_approval", title: "Commercial Approvals", route: "/approvals", group: "project_management", permissionModule: "ra_approval", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 30 },

  { code: "work_orders", title: "Work Orders", route: "/work-orders", group: "purchase", permissionModule: "work_orders", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "wo_approval", title: "Work Order Approval", route: "/approvals/work-orders", group: "purchase", permissionModule: "wo_approval", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },

  { code: "invoices", title: "Invoices", route: "/invoices", group: "accounts", permissionModule: "invoices", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "itc_claims", title: "ITC Review", route: "/invoices/itc", group: "accounts", permissionModule: "itc_claims", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },
  { code: "payments", title: "Payments", route: "/payments", group: "accounts", permissionModule: "payments", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 30 },

  { code: "hr_employees", title: "Employee Registration", route: "/hr/employees", group: "hr", permissionModule: "hr_employees", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "hr_employee_import", title: "Employee Import", route: "/hr/employees/import", group: "hr", permissionModule: "hr_employee_import", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },
  { code: "reimbursements", title: "Reimbursements", route: "/hr/reimbursements", group: "hr", permissionModule: "reimbursements", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 30 },

  { code: "companies", title: "Companies", route: "/companies", group: "settings", permissionModule: "companies", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "sites", title: "Sites", route: "/sites", group: "settings", permissionModule: "sites", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },
  { code: "vendors", title: "Vendors", route: "/vendors", group: "settings", permissionModule: "vendors", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 30 },
  { code: "company_bank_accounts", title: "Bank Accounts", route: "/company-bank-accounts", group: "settings", permissionModule: "company_bank_accounts", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 40 },
  { code: "hr_departments", title: "Departments", route: "/hr/departments", group: "settings", permissionModule: "hr_departments", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 50 },
  { code: "hr_designations", title: "Designations", route: "/hr/designations", group: "settings", permissionModule: "hr_designations", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 60 },

  { code: "organizations", title: "Organizations", route: "/organizations", group: "administration", permissionModule: "organizations", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 10 },
  { code: "users", title: "Users", route: "/admin/users", group: "administration", permissionModule: "users", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 20 },
  { code: "roles", title: "Roles", route: "/admin/roles", group: "administration", permissionModule: "roles", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 30 },
  { code: "permissions", title: "Permissions", route: "/admin/permissions", group: "administration", permissionModule: "permissions", requiredAction: "view", sidebar: true, launcher: true, permissionMatrix: true, sortOrder: 40 },
];

export const RELEASED_COMPATIBILITY_LAUNCHER_ROUTES = new Set([
  "/modules",
  "/modules/administration",
  "/modules/hr",
  "/modules/accounts",
  "/modules/reports",
  "/modules/construction-management",
  "/modules/contract-management",
  "/modules/master-setup",
  "/modules/project-management",
  "/modules/purchase",
  "/modules/settings",
]);

export const RELEASED_COMPATIBILITY_LAUNCHER_GROUPS: Record<string, ReleasedModuleGroup[]> = {
  "/modules/administration": ["administration"],
  "/modules/hr": ["hr"],
  "/modules/accounts": ["accounts"],
  "/modules/construction-management": ["settings"],
  "/modules/contract-management": ["purchase", "project_management", "accounts"],
  "/modules/master-setup": ["settings"],
  "/modules/project-management": ["project_management"],
  "/modules/purchase": ["purchase"],
  "/modules/settings": ["settings"],
};

export const EXPLICITLY_UNRELEASED_ROUTE_PREFIXES = [
  "/hr/attendance",
  "/hr/attendance-approval",
  "/settings/policies/employee-attendance",
  "/labour",
  "/reports",
  "/modules/store-management",
  "/modules/support",
];

export function isExplicitlyUnreleasedRoute(pathname: string) {
  return EXPLICITLY_UNRELEASED_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function listReleasedSidebarPages() {
  return RELEASED_MODULES.filter((module) => module.sidebar);
}

export function listReleasedLauncherPages(group?: ReleasedModuleGroup) {
  return RELEASED_MODULES
    .filter((module) => module.launcher)
    .filter((module) => !group || module.group === group)
    .sort((first, second) => first.sortOrder - second.sortOrder);
}

export function listReleasedPermissionModules() {
  return RELEASED_MODULES
    .filter((module) => module.permissionMatrix)
    .map((module) => module.permissionModule);
}

export function findReleasedRoute(pathname: string) {
  return [...RELEASED_MODULES]
    .filter((module) => pathname === module.route || pathname.startsWith(`${module.route}/`))
    .sort((first, second) => second.route.length - first.route.length)[0] || null;
}

export function getCompatibilityLauncherGroups(pathname: string) {
  return RELEASED_COMPATIBILITY_LAUNCHER_GROUPS[pathname] || [];
}

export function findReleasedModuleByCode(moduleCode: string) {
  return RELEASED_MODULES.find((module) => module.code === moduleCode || module.permissionModule === moduleCode) || null;
}

export function getReleasedGroup(groupCode: string) {
  return RELEASED_GROUPS.find((group) => group.code === groupCode) || null;
}

export function normalizeReleasedGroupName(groupCode: string, fallback?: string | null) {
  return getReleasedGroup(groupCode)?.title || fallback || groupCode;
}

export function isReleasedModuleCode(moduleCode: string) {
  return RELEASED_MODULES.some((module) => module.code === moduleCode || module.permissionModule === moduleCode);
}
