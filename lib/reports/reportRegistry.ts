export const REPORT_FILTERS = ["date_from", "date_to", "site_id", "event", "search", "company_id", "department_id", "designation_id", "status", "employment_type"] as const;

export type ReportFilter = (typeof REPORT_FILTERS)[number];

export type ReportDefinition = {
  key: string;
  area: string;
  subject: string;
  type: string;
  description: string;
  requiredEntitlements: string[];
  requiredPermissions: Array<{ module: string; action: string }>;
  filters: ReportFilter[];
  exports: Array<"pdf" | "excel">;
  handler: string;
};

export const REPORT_REGISTRY: ReportDefinition[] = [{
  key: "labour_audit",
  area: "hr_labour",
  subject: "labour",
  type: "audit_trail",
  description: "Recorded labour-master and assignment changes.",
  requiredEntitlements: ["reports", "labour"],
  requiredPermissions: [
    { module: "reports", action: "view" },
    { module: "labour_workers", action: "view" },
  ],
  filters: [...REPORT_FILTERS],
  exports: ["pdf", "excel"],
  handler: "labour_audit",
}, {
  key: "vendor_master",
  area: "procurement",
  subject: "vendor",
  type: "vendor_master",
  description: "Organization-scoped vendor master with contact duplicate indicators.",
  requiredEntitlements: ["reports", "procurement"],
  requiredPermissions: [{ module: "reports", action: "view" }, { module: "vendors", action: "view" }],
  filters: ["search"], exports: ["pdf", "excel"], handler: "vendors",
}, {
  key: "vendor_audit",
  area: "procurement",
  subject: "vendor",
  type: "audit_trail",
  description: "Vendor creation and change history.",
  requiredEntitlements: ["reports", "procurement"],
  requiredPermissions: [{ module: "reports", action: "view" }, { module: "vendors", action: "view" }],
  filters: ["date_from", "date_to", "event", "search"], exports: ["pdf", "excel"], handler: "vendors",
}, {
  key: "employee_master",
  area: "hr_labour",
  subject: "employee",
  type: "master",
  description: "Authorized employee master fields within company and site scope.",
  requiredEntitlements: ["reports", "hr"],
  requiredPermissions: [{ module: "reports", action: "view" }, { module: "hr_employees", action: "view" }],
  filters: ["company_id", "site_id", "department_id", "designation_id", "status", "employment_type", "search"], exports: ["pdf", "excel"], handler: "employees",
}];

export const REPORT_AREAS = [{ key: "hr_labour", label: "HR & Labour" }, { key: "procurement", label: "Purchase / Procurement" }];

export function getReportDefinition(key: string) {
  return REPORT_REGISTRY.find((report) => report.key === key) || null;
}
