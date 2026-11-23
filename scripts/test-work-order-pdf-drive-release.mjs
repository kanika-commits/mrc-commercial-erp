import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");
const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const docs = fs.readFileSync("app/api/work-orders/documents/route.ts", "utf8");
const approved = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

assert.match(route, /requireAnyPermission/);
assert.match(route, /isInOrganizationScope/);
assert.match(route, /String\(order\.approval_status \|\| ""\)\.toLowerCase\(\) !== "approved"/);
assert.match(route, /addWorkOrderDraftWatermark/);
assert.match(route, /renderWorkOrderPdf\(/);
assert.match(route, /renderApprovedWorkOrderPdfById\(admin, id\)/);
assert.doesNotMatch(route, /pilot-reviewed-pdf/);
assert.match(page, /Official approved PDF/);
assert.match(page, /Draft\/reviewed PDF/);
assert.match(page, /Source attachments/);
assert.match(page, /packageErrorsByWorkOrder/);
assert.match(docs, /drive_sync_key/);
assert.match(approved, /!\["approved", "issued"\]\.includes/);
assert.match(approved, /no configured usable signature asset/);
assert.match(renderer, /\["Approved By", true, 9\]/);
assert.match(renderer, /`For: \$\{approverCompany\}`/);
assert.match(renderer, /\["Signature:", false, 8\]/);
assert.match(renderer, /`Designation: \$\{approverTitle\}`/);
assert.doesNotMatch(renderer, /Approved At: \$\{approverAt\}/);

console.log("Work Order PDF/Drive release contract passed.");
