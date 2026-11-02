import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync("app/work-orders/drafts/[id]/page.tsx", "utf8");
const register = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const pdfRoute = fs.readFileSync("app/api/work-orders/drafts/[id]/preview/route.ts", "utf8");

assert.match(register, /title="View"/);
assert.match(detail, /data-testid="work-order-draft-detail"/);
assert.match(detail, /Draft — Not submitted/);
assert.match(detail, /Edit Draft/);
assert.match(detail, /Submit for Approval/);
assert.match(detail, /data-testid="work-order-draft-pdf"/);
assert.match(detail, /\/api\/work-orders\/drafts\/\$\{params\.id\}\/preview/);
assert.match(pdfRoute, /standard_terms_clauses: result\.data\.standard_terms_snapshot/);
assert.match(pdfRoute, /Content-Disposition.*inline/);

console.log("Work Order draft inline PDF viewer contract passed.");
