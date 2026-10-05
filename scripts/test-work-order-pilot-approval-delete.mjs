import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const page = read("../app/approvals/work-orders/page.tsx");
const route = read("../app/api/approvals/work-orders/[id]/route.ts");
const migration = read("../supabase/migrations/202610050001_work_order_platform_owner_delete.sql");

assert.match(page, /roleCodes\?\.includes\("platform_owner"\)/);
assert.match(page, /Permanently delete Work Order/);
assert.match(page, /Drive and Supabase Storage files will be preserved/);
assert.match(page, /method: "DELETE"/);
assert.match(page, /approvals\/work-orders\/\$\{wo\.id\}/);
assert.match(route, /loadPermissionContext/);
assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
assert.match(route, /Work Order deletion is available only in the Production deployment/);
assert.match(route, /roleCodes\.includes\("platform_owner"\)/);
assert.match(route, /Only a Platform Owner can permanently delete/);
assert.match(route, /delete_work_order_atomic/);
assert.match(route, /work_order_items/);
assert.match(route, /work_order_documents/);
assert.match(route, /work_order_vendors/);
assert.match(route, /work_order_files/);
assert.match(route, /work_order_changes/);
assert.match(route, /work_order_drive_folders/);
assert.match(route, /accounts_direct_requisitions/);
assert.match(route, /labour_wage_rates/);
assert.match(route, /payment_requisition_lines/);
assert.match(migration, /create or replace function public\.delete_work_order_atomic/);
assert.match(migration, /delete from public\.work_order_items/);
assert.match(migration, /delete from public\.work_order_documents/);
assert.match(migration, /delete from public\.work_order_vendors/);
assert.match(migration, /delete from public\.work_order_files/);
assert.match(migration, /delete from public\.work_order_changes/);
assert.match(migration, /delete from public\.work_order_drive_folders/);
assert.match(migration, /revoke all on function public\.delete_work_order_atomic\(uuid\)[\s\S]+grant execute[\s\S]+to service_role/);
assert.match(page, /workOrderDeletionEnabled/);
assert.match(page, /workOrderDeletionEnabled === true/);

const approvalsRoute = read("../app/api/approvals/work-orders/route.ts");
assert.match(approvalsRoute, /workOrderDeletionEnabled/);
assert.match(approvalsRoute, /process\.env\.VERCEL_ENV === "production"/);

console.log("Work Order approval Platform Owner delete contract passed.");
