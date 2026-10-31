import assert from "node:assert/strict";
import fs from "node:fs";
const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
assert.match(page, /Select Site/); assert.match(page, /site_id/); assert.match(page, /lookup=work_orders&site_id=/);
assert.match(page, /pilot-ra-bills\?lookup=sites/); assert.match(page, /setSites\(d\.sites \|\| \[\]\)/);
assert.match(page, /s\.site_name \|\| s\.name/); assert.match(page, /Loading authorized Sites/); assert.match(page, /Sites unavailable/);
assert.match(page, /import \{ apiFetch \} from "@\/components\/hr\/hrClient"/); assert.doesNotMatch(page, /fetch\("\/api\/work-orders\/pilot-ra-bills\?lookup=sites"/);
assert.match(page, /Select Work Order/); assert.match(page, /disabled={!siteId \|\| orderState === "loading"}/); assert.match(page, /lookup=work_orders&site_id=/);
assert.doesNotMatch(page, /api\/work-orders\/register\?pilot_only/);
assert.match(route, /not\("creation_request_id", "is", null\)/); assert.match(route, /approval_status/, "Pilot route enforces approved status");
assert.match(route, /work_order_pilot_revisions/); assert.match(route, /effective_revision/);
assert.match(route, /searchParams\.get\("lookup"\) === "sites"/); assert.match(route, /from\("sites"\)/); assert.match(route, /applyOrganizationScope/);
assert.match(route, /searchParams\.get\("lookup"\) === "work_orders"/); assert.match(route, /eq\("site_id", siteId\)/); assert.match(route, /eq\("approval_status", "approved"\)/); assert.match(route, /work_order_pilot_revisions/);
assert.doesNotMatch(page, /Select Company/);
// Pilot numbering intentionally reads legacy RA Bill history so numbers cannot
// collide across workflows.  The query must remain Work Order + organization
// scoped; rejecting the table read itself was an obsolete expectation.
assert.match(route, /from\("ra_bills"\)\.select\("ra_number,approval_status"\)\.eq\("organization_id", organizationId\)\.eq\("work_order_id", workOrderId\)/);
console.log("Pilot RA Bill Site -> approved Pilot Work Order filtering contract passed.");
