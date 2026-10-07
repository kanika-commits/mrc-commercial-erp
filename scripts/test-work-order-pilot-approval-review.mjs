import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const approvalPage = read("../app/approvals/work-orders/page.tsx");
const approvalApi = read("../app/api/approvals/work-orders/route.ts");
const pdfRoute = read("../app/api/work-orders/[id]/generated-pdf/route.ts");
const detailPage = read("../app/work-orders/[id]/page.tsx");
const createRoute = read("../app/api/work-orders/create/route.ts");
const sync = read("../lib/workOrderPilotDriveSync.server.ts");
const packageRenderer = read("../lib/workOrderApprovedPdf.server.ts");
const supporting = read("../lib/workOrderSupportingDocuments.server.ts");
const dateTime = read("../lib/dateTime.ts");

assert.match(approvalApi, /creation_request_id/);
assert.match(approvalPage, /Review Complete Work Order PDF/);
assert.doesNotMatch(approvalPage, /openDocument|currentDocuments|>Open<|work-orders\/documents/);
assert.match(approvalPage, /generated-pdf/);
assert.match(approvalPage, /response\.blob\(\)/);
assert.match(detailPage, /creation_request_id/);
assert.match(detailPage, /Review Complete Work Order PDF/);
assert.doesNotMatch(detailPage, /Load Work Order files|loadDocuments|openDocument|documentsLoaded/);
assert.match(detailPage, /generated-pdf/);
assert.match(detailPage, /response\.blob\(\)/);
assert.match(dateTime, /timeZone: "Asia\/Kolkata"/);
assert.match(createRoute, /work_order_documents/);
assert.match(createRoute, /structured-pilot/);
assert.match(pdfRoute, /requireAnyPermission/);
assert.match(pdfRoute, /wo_approval/);
assert.match(pdfRoute, /loadApprovalScope/);
assert.match(pdfRoute, /approvalScope\.assignments/);
assert.match(packageRenderer, /work_order_documents/);
assert.match(packageRenderer, /order\(\"uploaded_at\", \{ ascending: true \}\)/);
assert.match(packageRenderer, /drive_sync_key !== \"pilot-generated-pdf\"/);
assert.match(packageRenderer, /appendWorkOrderSupportingPdfs/);
assert.match(packageRenderer, /new File\(\[await downloaded\.data\.arrayBuffer\(\)\]/);
assert.match(packageRenderer, /not available from Work Order storage for review/);
assert.match(supporting, /application\/pdf/);
assert.match(supporting, /image\/png/);
assert.match(supporting, /image\/jpeg/);
assert.match(supporting, /Supporting attachment/);
assert.match(sync, /createWorkOrderDriveFolder/);
assert.match(sync, /existingDriveFile/);
assert.match(sync, /drive_sync_key: "pilot-generated-pdf"/);
assert.match(sync, /onConflict: "work_order_id,drive_sync_key"/);
assert.match(sync, /pilot_drive_sync_status: "succeeded"/);

console.log("Work Order Pilot pre-approval review and post-approval sync contract passed.");
