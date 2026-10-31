import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/route.ts", "utf8");
const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const deleteHandler = route.slice(route.indexOf("export async function DELETE"));

assert.match(route, /deletionReason\.length < 10/);
assert.match(route, /approval_status.*draft/);
assert.match(route, /Only draft Work Orders can be deleted/);
assert.match(route, /countDirectLinks\(admin, "ra_bills"/);
assert.match(route, /countDirectLinks\(admin, "payments"/);
assert.match(route, /countDirectLinks\(admin, "work_order_pilot_ra_bills"/);
assert.match(route, /countDirectLinks\(admin, "labour_work_groups"/);
assert.match(route, /countDirectLinks\(admin, "labour_daily_work_logs"/);
assert.match(route, /loadOptionalChildRows\(admin, "work_order_items"/);
assert.match(route, /loadOptionalChildRows\(admin, "work_order_changes"/);
assert.match(route, /delete_work_order_atomic/);
assert.match(route, /deleteError\.code === "23503"/);
assert.match(route, /still has linked records and was not deleted/);
assert.match(route, /loadOrganizationScopeForUser\(admin, auth\.user\.id\)/);
assert.match(route, /loadActorAssignments\(admin, auth\.user\.id\)/);
assert.match(route, /isWorkOrderInActorScope\(workOrder, organizationScope, assignments\)/);
assert.match(route, /work_order_items: items/);
assert.match(route, /recordSnapshot: deleted \|\| workOrder/);
assert.match(route, /preserved_storage_files/);
assert.doesNotMatch(deleteHandler, /\.from\("work_orders"\)\s*\.delete\(\)/);
assert.match(page, /canDeleteWorkOrder/);
assert.match(page, /approval_status \|\| ""\)\.toLowerCase\(\) === "draft"/);

console.log("Work Order delete safety contract passed.");
