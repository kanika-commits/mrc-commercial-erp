import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const exists = (path) => fs.existsSync(path);
const reportsPage = read("app/reports/page.tsx");
const registry = read("lib/reports/reportRegistry.ts");
const labourPage = read("app/reports/labour-audit/page.tsx");
const labourApi = read("app/api/reports/labour-audit/route.ts");
const authGuard = read("components/AuthGuard.tsx");
const visibility = read("lib/permissionVisibility.ts");

assert.match(reportsPage, /Report Centre/);
assert.match(reportsPage, /Area \/ Module/);
assert.match(reportsPage, /Report For/);
assert.match(reportsPage, /Report Type/);
assert.match(reportsPage, /Generate Report/);
assert.match(reportsPage, /Download PDF/);
assert.match(reportsPage, /Export Excel/);
assert.match(reportsPage, /All Sites/);
assert.match(reportsPage, /metadata=true/);
assert.match(reportsPage, /Previous/);
assert.match(reportsPage, /Next/);
assert.match(registry, /REPORT_REGISTRY/);
assert.match(registry, /labour_audit/);
assert.match(registry, /hr_labour/);
assert.match(registry, /audit_trail/);
assert.match(registry, /reports.*view/s);
assert.match(registry, /labour_workers.*view/s);
assert(!exists("app/reports/builder/page.tsx"), "the retired builder must be removed");
assert(!exists("app/api/reports/run/route.ts"), "the retired generic report API must be removed");
assert(!exists("lib/reports/reportCatalog.ts"), "the retired report catalogue must be removed");
assert(!exists("lib/reports/workOrderDataset.ts"), "the retired work-order report dataset must be removed");

assert.match(authGuard, /pathname === "\/reports" \|\| pathname\.startsWith\("\/reports\/"\)/);
assert.match(authGuard, /can\(access\.permissions, "reports", "view"\)/);
assert.match(visibility, /visible_group: "Reports"/);
assert.match(visibility, /visible_actions: \["view"\]/);

for (const pattern of ["loadPermissionContext(request)", "hasServerPermission(auth, \"reports\", \"view\")", "hasServerPermission(auth, \"labour_workers\", \"view\")", "organization_modules", "reports", "labour", "erp_audit_logs", "module_code", "labour_workers", "loadActorOrganizationScope", "isInOrganizationScope", "applyCompanySiteScope", "PAGE_SIZE = 50", "metadata", "format === \"excel\"", "format === \"pdf\""]) {
  assert.match(labourApi, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Labour Audit API must include ${pattern}`);
}
assert.doesNotMatch(labourApi, /from\("role_permissions"\)|save_|insert\(|update\(|delete\(/, "the report endpoint must remain read-only");
assert.match(labourApi, /Selected site is outside your authorized scope/);
assert.match(labourApi, /assignments\.siteIds/);
assert.match(labourApi, /range\(start, start \+ pageSize - 1\)/);
assert.match(labourApi, /organization_id.*organizationId/);
assert.match(labourPage, /date_from|From/);
assert.match(labourPage, /date_to|To/);
assert.match(labourPage, /Event/);
assert.match(labourPage, /Search/);
assert.match(labourPage, /Details/);
assert.match(labourPage, /format=\$\{format\}/);
assert.match(labourPage, /Labour Audit Report/);

console.log("Reports module rules passed.");
