import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");
const approved = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const route = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");
const listPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const detailPage = fs.readFileSync("app/work-orders/[id]/page.tsx", "utf8");

assert.match(renderer, /\["Approved By", true, 9\]/);
assert.match(renderer, /`For: \$\{approverCompany\}`/);
assert.match(renderer, /\["Signature:", false, 8\]/);
assert.match(renderer, /`Name: \$\{approverName\}`/);
assert.match(renderer, /`Designation: \$\{approverTitle\}`/);
assert.doesNotMatch(renderer, /\[\`Email: \$\{approverEmail\}/);
assert.doesNotMatch(renderer, /Approved At: \$\{approverAt\}/);
assert.match(renderer, /Vendor Acceptance/);
assert.match(approved, /addWorkOrderDraftWatermark/);
assert.match(approved, /reviewedDocument && !approved/);
assert.match(approved, /creation_request_id && !approved/);
assert.match(approved, /cannot be regenerated from an incomplete source/);
assert.match(approved, /no configured usable signature asset/);
assert.match(approved, /pilot-reviewed-pdf/);
assert.match(route, /filename=.*wo_number.*\.pdf/);
assert.doesNotMatch(route, /approved_at.*filename/);
assert.match(route, /creation_request_id && !approved/);
assert.match(listPage, /Official approved PDF/);
assert.match(listPage, /Source attachment:/);
assert.match(detailPage, /Open official approved PDF/);
assert.match(detailPage, /Source attachment:/);
assert.match(detailPage, /document\.drive_sync_key !== "pilot-generated-pdf"/);

console.log("Approved Work Order PDF contract passed.");
