import assert from "node:assert/strict";
import fs from "node:fs";

const reportsPage = fs.readFileSync("app/reports/page.tsx", "utf8");
const builderPage = fs.readFileSync("app/reports/builder/page.tsx", "utf8");
const catalog = fs.readFileSync("lib/reports/reportCatalog.ts", "utf8");
const workOrderDataset = fs.readFileSync("lib/reports/workOrderDataset.ts", "utf8");
const runApi = fs.readFileSync("app/api/reports/run/route.ts", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");

assert.match(reportsPage, /Create Custom Report/, "Reports landing page must prioritize Create Custom Report");
assert.match(reportsPage, /href="\/reports\/builder"/, "Create Custom Report must open the builder shell");
assert.match(reportsPage, /Standard Reports/, "Reports landing page must include a compact Standard Reports section");
assert.match(reportsPage, /Saved Reports/, "Reports landing page must reserve a Saved Reports option");
assert.match(reportsPage, /Dashboards/, "Reports landing page must reserve a Dashboards option");
assert.match(reportsPage, /Available Data Sources/, "Reports landing page must show dataset categories");
assert.doesNotMatch(reportsPage, /group\.reports\.map/, "Reports landing page must not render large per-report card grids");
assert.doesNotMatch(reportsPage, /Coming next[\s\S]*Coming next[\s\S]*Coming next/, "Reports landing page must not show many repeated Coming next report buttons");

assert.match(builderPage, /Dataset/, "Report builder shell must include Dataset selector");
assert.match(builderPage, /Fields/, "Report builder shell must include Fields section");
assert.match(builderPage, /Filters/, "Report builder shell must include Filters section");
assert.match(builderPage, /Grouping/, "Report builder shell must include Grouping section");
assert.match(builderPage, /Measures/, "Report builder shell must include Measures section");
assert.match(builderPage, /Visualization/, "Report builder shell must include Visualization selector");
assert.match(builderPage, /Preview/, "Report builder shell must include Preview area");
assert.match(builderPage, /Run Report/, "Report builder shell must include Run Report button");
assert.match(builderPage, /Reset/, "Report builder shell must include Reset button");
assert.match(builderPage, /fetch\(`\/api\/reports\/run\?dataset=\$\{WORK_ORDER_DATASET_CODE\}`/, "Builder must load controlled Work Order metadata");
assert.match(builderPage, /fetch\("\/api\/reports\/run"/, "Builder must run reports through the controlled endpoint");
assert.match(builderPage, /compatibleVisualizations/, "Builder must disable incompatible visualization choices");

assert.match(catalog, /REPORT_DATASETS/, "Report catalogue must expose datasets");
assert.match(catalog, /STANDARD_REPORT_TEMPLATES/, "Report catalogue must expose standard templates");
assert.doesNotMatch(catalog, /Vendor-wise Work Order Report/, "Filter/grouping variations must not be top-level standard report cards");
assert.doesNotMatch(catalog, /Department-wise Employee Report/, "Department-wise reports must be builder grouping variations");
assert.doesNotMatch(catalog, /Contractor-wise Labour Report/, "Contractor-wise reports must be builder grouping variations");

assert.match(workOrderDataset, /WORK_ORDER_DATASET_CODE = "work_orders"/, "Only the Work Orders dataset is enabled in this POC");
for (const field of ["wo_number", "wo_date", "company", "site", "vendor", "wo_type", "status", "approval_status", "basic_value", "gst_amount", "total_value"]) {
  assert.match(workOrderDataset, new RegExp(`code: "${field}"`), `${field} must be a controlled Work Order field`);
}
for (const filter of ["date_from", "date_to", "company_id", "site_id", "vendor_id", "wo_type", "status", "approval_status"]) {
  assert.match(workOrderDataset, new RegExp(`code: "${filter}"`), `${filter} must be a controlled Work Order filter`);
}
for (const measure of ["record_count", "sum_basic_value", "sum_gst_amount", "sum_total_value"]) {
  assert.match(workOrderDataset, new RegExp(`code: "${measure}"`), `${measure} must be a controlled Work Order measure`);
}

assert.match(runApi, /loadPermissionContext\(request\)/, "Report API must require authentication");
assert.match(runApi, /hasServerPermission\(auth, "reports", "view"\)/, "Report API must require reports:view");
assert.match(runApi, /hasServerPermission\(auth, "work_orders", "view"\)/, "Report API must require work_orders:view");
assert.match(runApi, /payload\?\.dataset !== WORK_ORDER_DATASET_CODE/, "Report API must reject unsupported datasets");
assert.match(runApi, /Unsupported field/, "Report API must reject unsupported fields");
assert.match(runApi, /Unsupported filter/, "Report API must reject unsupported filters");
assert.match(runApi, /Unsupported grouping/, "Report API must reject unsupported grouping");
assert.match(runApi, /Unsupported measure/, "Report API must reject unsupported measures");
assert.match(runApi, /Unsupported sort field/, "Report API must reject unsupported sort fields");
assert.match(runApi, /Select at least one field for a table report/, "Table reports must require selected fields");
assert.match(runApi, /KPI reports cannot use grouping/, "KPI reports must reject grouping");
assert.match(runApi, /Chart reports require one grouping/, "Chart reports must require grouping");
assert.match(runApi, /WORK_ORDER_TABLE_PAGE_SIZE_MAX/, "Report API must enforce maximum table page size");
assert.match(runApi, /WORK_ORDER_CHART_GROUP_LIMIT/, "Report API must enforce chart group limits");
assert.match(runApi, /applyOrganizationScope/, "Report API must apply organization scope");
assert.match(runApi, /user_access_assignments/, "Report API must apply company and site assignments");
assert.doesNotMatch(runApi, /payload\.(table|column|sql)|from\(payload|rpc\(payload/, "Report API must not accept arbitrary table, column, SQL or RPC names");

assert.match(authGuard, /pathname === "\/reports" \|\| pathname\.startsWith\("\/reports\/"\)[\s\S]+can\(access\.permissions, "reports", "view"\)/, "Reports routes must require reports:view");
assert.match(permissionMatrix, /reports: \["view", "export"\]/, "Reports permission must retain view/export actions");
assert.doesNotMatch(visibility, /"reports",/, "Reports must no longer be hidden from the Permission Matrix");
assert.match(visibility, /reports: \{[\s\S]+visible_group: "Reports"[\s\S]+visible_actions: \["view", "export"\]/, "Reports must be visible with view/export actions");

console.log("Reports module rules passed.");
