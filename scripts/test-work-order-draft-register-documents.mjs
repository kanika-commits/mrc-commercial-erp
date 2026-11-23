import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const reviewedRoute = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");

assert.match(page, /function loadDraftPackage\(workOrder: WorkOrder\)/);
assert.match(page, /\/api\/work-orders\/drafts\/\$\{encodeURIComponent\(workOrder\.id\)\}\/preview/);
assert.match(page, /isApprovedWorkOrder\(wo\)/);
assert.match(page, /Official approved PDF/);
assert.match(page, /Draft\/reviewed PDF/);
assert.match(page, /Source attachments/);
assert.match(reviewedRoute, /addWorkOrderDraftWatermark/);
assert.match(reviewedRoute, /renderWorkOrderPdf\(/);

console.log("Work Order draft register documents check passed");
