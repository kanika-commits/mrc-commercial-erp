import assert from "node:assert/strict";
import fs from "node:fs";

const listPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const registerRoute = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");
const deleteRoute = fs.readFileSync("app/api/work-orders/route.ts", "utf8");

assert.match(listPage, /creation_request_id\?: string \| null/);
assert.match(listPage, /isDraft \? `\/work-orders\/drafts\/\$\{wo\.id\}`/);
assert.match(listPage, /\(isDraft \|\| canDelete\) &&/);
assert.match(formsPage, /import WorkOrdersPage from "@\/app\/work-orders\/page"/);
assert.match(registerRoute, /creation_request_id/);
assert.match(registerRoute, /approval_status\.ilike\.draft/);
assert.match(deleteRoute, /requirePermission\(request, MODULE_CODE, "view"\)/);
assert.match(deleteRoute, /loadActorOrganizationScope\(admin, listAccess\)/);
assert.match(deleteRoute, /user_access_assignments/);
assert.match(deleteRoute, /siteIds\.has\(workOrder\.site_id\)/);
assert.match(deleteRoute, /companyIds\.has\(workOrder\.company_id\)/);
assert.match(deleteRoute, /requireDeletePermission\(/);

console.log("Work Order Forms list integration checks passed.");
