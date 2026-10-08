import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const registerRoute = fs.readFileSync("app/api/work-orders/register/[id]/route.ts", "utf8");
const approvalRoute = fs.readFileSync("app/api/approvals/work-orders/[id]/route.ts", "utf8");

assert.match(page, /\/api\/work-orders\/register\/\$\{encodeURIComponent\(deleteWorkOrder\.id\)\}/);
assert.match(page, /if \(!response\.ok\)/);
assert.match(page, /setWorkOrders\(\(prev\) => prev\.filter/);
assert.match(registerRoute, /VERCEL_ENV !== "production"/);
assert.match(registerRoute, /roleCodes\.includes\("platform_owner"\)/);
assert.match(registerRoute, /delete_work_order_atomic/);
assert.match(registerRoute, /Cannot delete a Work Order with linked financial records/);
assert.match(registerRoute, /insertDeleteAudit/);
assert.doesNotMatch(registerRoute, /\.from\("work_orders"\)\.delete/);
assert.match(approvalRoute, /Approved Work Orders cannot be deleted from the approval queue/);
console.log("Work Order register-delete route/UI contract passed.");
