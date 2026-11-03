import assert from "node:assert/strict";
import fs from "node:fs";

const register = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const page = fs.readFileSync("app/work-orders/drafts/[id]/page.tsx", "utf8");
const draftApi = fs.readFileSync("app/api/work-orders/drafts/[id]/route.ts", "utf8");
const previewApi = fs.readFileSync("app/api/work-orders/drafts/[id]/preview/route.ts", "utf8");
const draftHelper = fs.readFileSync("lib/serverWorkOrderDraft.ts", "utf8");
assert.match(register, /creation_request_id/);

assert.match(register, /function workOrderViewHref\(wo[^\n]*pilotOnly[^\n]*\)/);
assert.match(register, /const approvalStatus = String\(wo\.approval_status \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
assert.match(register, /if \(approvalStatus === "draft" && wo\.creation_request_id\) return `\/work-orders\/drafts\/\$\{wo\.id\}`/);
assert.match(register, /return pilotOnly \? `\/work-orders\/\$\{wo\.id\}\?from=forms-work-orders` : `\/work-orders\/\$\{wo\.id\}`/);
assert.equal((register.match(/href=\{workOrderViewHref\(wo, pilotOnly\)\}/g) || []).length, 2, "number and eye links must share draft routing");
assert.match(page, /data-testid="work-order-draft-detail"/);
assert.match(page, /Edit Draft/);
assert.match(page, /Submit for Approval/);
assert.match(page, /\/api\/work-orders\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/preview/);
assert.match(page, /data-testid="work-order-draft-pdf"/);
assert.match(draftApi, /approval_status", "draft"/);
assert.match(draftHelper, /requirePermission\(request, "work_orders", "edit"\)/);
assert.match(previewApi, /loadAuthorizedWorkOrderDraft\(request/);
assert.match(previewApi, /Content-Disposition.*inline/);
assert.match(previewApi, /standard_terms_clauses: result\.data\.standard_terms_snapshot/);

console.log("Work Order draft viewing contract passed.");
