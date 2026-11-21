import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("app/api/work-orders/pilot/availability/route.ts", "utf8");
const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const preview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");

assert.match(api, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(api, /const scope = auth\.isGlobalAccess \? null : auth\.organizations/);
assert.doesNotMatch(api, /loadActorOrganizationScope/);
assert.match(api, /vendor_id/);
assert.match(api, /canonicalType/);
assert.match(api, /available: true/);
assert.match(api, /available: false/);
assert.match(api, /rpc\("validate_work_order_pilot_creation", \{[\s\S]*p_organization_id: company\.organization_id,[\s\S]*p_company_id: company\.id,[\s\S]*p_site_id: site\.id,[\s\S]*p_vendor_id: vendor\.id,[\s\S]*p_work_order_type: workOrderType/);
assert.match(api, /Create a revision of that Work Order instead/);
assert.match(api, /company\.organization_id !== vendor\.organization_id/);
assert.match(api, /site\.organization_id !== vendor\.organization_id/);
assert.match(api, /site\.company_id !== null && site\.company_id !== company\.id/);
assert.match(api, /const companyAllowed = auth\.isGlobalAccess \|\| auth\.companies\.length === 0 \|\| auth\.companies\.includes\(company\.id\)/);
assert.match(api, /const siteAllowed = auth\.isGlobalAccess \|\| auth\.sites\.length === 0 \|\| auth\.sites\.includes\(site\.id\)/);
assert.match(api, /const draftId = text\(params\.get\("draft_id"\)\)/);
assert.match(api, /draft\.approval_status !== "draft"/);
assert.match(api, /!draft\.creation_request_id/);
assert.match(api, /draft\.company_id !== company\.id/);
assert.match(api, /draft\.site_id !== site\.id/);
assert.match(api, /draft\.pilot_vendor_id !== vendor\.id/);
assert.match(api, /const conflict = \(candidates \|\| \[\]\)\.find\(\(row: WorkOrderLike\) => row\.id !== editableDraftId/);
assert.match(api, /if \(!conflict\) return NextResponse\.json\(\{ available: true/);
assert.match(api, /if \(duplicateError\) throw duplicateError/);

assert.match(form, /draftParam = draftId \? `&draft_id=\$\{encodeURIComponent\(draftId\)\}`/);
assert.match(form, /api\/work-orders\/pilot\/availability/);
assert.match(form, /Checking Work Order availability/);
assert.match(form, /availability\.state === "blocked"/);
assert.match(form, /disabled=\{saving \|\| \(!revisionId && availability\.state !== "available"\)\}/);
assert.match(form, /if \(!revisionId && availability\.state !== "available"\)/);

assert.match(preview, /api\/work-orders\/pilot\/availability/);
assert.match(preview, /company_id=\$\{encodeURIComponent\(draft\.payload\.company_id\)\}/);
assert.match(preview, /site_id=\$\{encodeURIComponent\(draft\.payload\.site_id\)\}/);
assert.match(preview, /draft_id=\$\{encodeURIComponent\(draftId\)\}/);
assert.match(preview, /availability\.state === "blocked"/);
assert.match(preview, /availability\.state !== "available"/);

assert.match(create, /validate_work_order_pilot_creation/);
assert.match(create, /p_vendor_id: vendor\.id/);
assert.match(create, /p_work_order_type: woType/);

console.log("Pilot availability contract checks passed.");
