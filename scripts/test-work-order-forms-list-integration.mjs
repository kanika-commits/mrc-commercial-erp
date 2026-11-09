import assert from "node:assert/strict";
import fs from "node:fs";

const listPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const registerRoute = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");
const deleteRoute = fs.readFileSync("app/api/work-orders/route.ts", "utf8");

assert.match(listPage, /creation_request_id\?: string \| null/);
assert.match(listPage, /isDraft \? `\/work-orders\/drafts\/\$\{wo\.id\}`/);
assert.match(listPage, /\(isDraft \|\| canDelete\) &&/);
assert.match(formsPage, /import \{ WorkOrdersPage \} from "@\/app\/work-orders\/page"/);
assert.match(formsPage, /<WorkOrdersPage pilotOnly \/>/);
assert.match(registerRoute, /creation_request_id/);
assert.match(registerRoute, /approval_status\.in\.\(draft,pending,approved\)/);
assert.match(registerRoute, /status\.eq\.active/);
assert.match(deleteRoute, /requirePermission\(request, MODULE_CODE, "view"\)/);
assert.match(deleteRoute, /loadOrganizationScopeForUser\(admin, auth\.user\.id\)/);
assert.match(deleteRoute, /user_access_assignments/);
assert.match(deleteRoute, /siteIds\.includes\(workOrder\.site_id\)/);
assert.match(deleteRoute, /companyIds\.includes\(workOrder\.company_id\)/);
assert.match(deleteRoute, /approval_status \|\| ""\)\.toLowerCase\(\) === "draft"/);
assert.match(deleteRoute, /requireDeletePermission\(/);

console.log("Work Order Forms list integration checks passed.");
