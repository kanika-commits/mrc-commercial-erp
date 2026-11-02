import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync("app/work-orders/[id]/page.tsx", "utf8");
const register = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const pdfRoute = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");

assert.match(register, /title="View"/);
assert.match(detail, /data-testid="work-order-draft-detail"/);
assert.match(detail, /Draft — Not submitted/);
assert.match(detail, /Edit Draft/);
assert.match(detail, /Submit for Approval/);
assert.match(detail, /data-testid="work-order-draft-pdf-package"/);
assert.match(detail, /title="Work Order PDF package"/);
assert.match(detail, /if \(woData\.approval_status === "draft" && woData\.creation_request_id\)/);
assert.match(detail, /void loadDraftPreview\(displayWorkOrder\)/);
assert.match(detail, /fetch\("\/api\/work-orders\/preview"/);
assert.match(detail, /pdf_base64/);
assert.match(detail, /generated from the saved draft for preview only/);
assert.match(detail, /Load supporting documents/);
assert.match(detail, /View \/ download Work Order PDF package/);
assert.match(pdfRoute, /Content-Disposition.*inline/);
assert.match(pdfRoute, /Content-Disposition.*inline/);

console.log("Work Order draft inline PDF viewer contract passed.");
