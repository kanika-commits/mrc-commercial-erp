export const REPORT_FILTERS = ["date_from", "date_to", "site_id", "event", "search"] as const;

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
}];

export const REPORT_AREAS = [{ key: "hr_labour", label: "HR & Labour" }];

export function getReportDefinition(key: string) {
  return REPORT_REGISTRY.find((report) => report.key === key) || null;
}
