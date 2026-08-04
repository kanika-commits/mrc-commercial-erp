export type WorkOrderFieldCode =
  | "wo_number"
  | "wo_date"
  | "company"
  | "site"
  | "vendor"
  | "wo_type"
  | "status"
  | "approval_status"
  | "basic_value"
  | "gst_amount"
  | "total_value";

export type WorkOrderFilterCode =
  | "date_from"
  | "date_to"
  | "company_id"
  | "site_id"
  | "vendor_id"
  | "wo_type"
  | "status"
  | "approval_status";

export type WorkOrderGroupCode =
  | "company"
  | "site"
  | "vendor"
  | "wo_type"
  | "status"
  | "approval_status";

export type WorkOrderMeasureCode =
  | "record_count"
  | "sum_basic_value"
  | "sum_gst_amount"
  | "sum_total_value";

export type ReportVisualization = "table" | "kpi" | "pie" | "bar";

export const WORK_ORDER_DATASET_CODE = "work_orders";

export const WORK_ORDER_FIELDS: Array<{
  code: WorkOrderFieldCode;
  label: string;
  type: "text" | "date" | "money";
  sortable?: boolean;
}> = [
  { code: "wo_number", label: "Work Order Number", type: "text", sortable: true },
  { code: "wo_date", label: "Work Order Date", type: "date", sortable: true },
  { code: "company", label: "Company", type: "text" },
  { code: "site", label: "Site", type: "text" },
  { code: "vendor", label: "Vendor", type: "text" },
  { code: "wo_type", label: "Work Order Type", type: "text" },
  { code: "status", label: "Status", type: "text", sortable: true },
  { code: "approval_status", label: "Approval Status", type: "text", sortable: true },
  { code: "basic_value", label: "Basic Value", type: "money", sortable: true },
  { code: "gst_amount", label: "GST Amount", type: "money" },
  { code: "total_value", label: "Total Value", type: "money" },
];

export const WORK_ORDER_FILTERS: Array<{
  code: WorkOrderFilterCode;
  label: string;
  type: "date" | "select";
}> = [
  { code: "date_from", label: "Date From", type: "date" },
  { code: "date_to", label: "Date To", type: "date" },
  { code: "company_id", label: "Company", type: "select" },
  { code: "site_id", label: "Site", type: "select" },
  { code: "vendor_id", label: "Vendor", type: "select" },
  { code: "wo_type", label: "Work Order Type", type: "select" },
  { code: "status", label: "Status", type: "select" },
  { code: "approval_status", label: "Approval Status", type: "select" },
];

export const WORK_ORDER_GROUPS: Array<{
  code: WorkOrderGroupCode;
  label: string;
}> = [
  { code: "company", label: "Company" },
  { code: "site", label: "Site" },
  { code: "vendor", label: "Vendor" },
  { code: "wo_type", label: "Work Order Type" },
  { code: "status", label: "Status" },
  { code: "approval_status", label: "Approval Status" },
];

export const WORK_ORDER_MEASURES: Array<{
  code: WorkOrderMeasureCode;
  label: string;
  type: "count" | "money";
}> = [
  { code: "record_count", label: "Record Count", type: "count" },
  { code: "sum_basic_value", label: "Sum of Basic Value", type: "money" },
  { code: "sum_gst_amount", label: "Sum of GST Amount", type: "money" },
  { code: "sum_total_value", label: "Sum of Total Value", type: "money" },
];

export const WORK_ORDER_VISUALIZATIONS: Array<{
  code: ReportVisualization;
  label: string;
}> = [
  { code: "table", label: "Table" },
  { code: "kpi", label: "KPI" },
  { code: "pie", label: "Pie Chart" },
  { code: "bar", label: "Bar Chart" },
];

export const WORK_ORDER_TABLE_SORT_FIELDS = new Set<WorkOrderFieldCode>([
  "wo_number",
  "wo_date",
  "status",
  "approval_status",
  "basic_value",
]);

export const WORK_ORDER_CHART_GROUP_LIMIT = 12;
export const WORK_ORDER_TABLE_PAGE_SIZE_DEFAULT = 25;
export const WORK_ORDER_TABLE_PAGE_SIZE_MAX = 100;
