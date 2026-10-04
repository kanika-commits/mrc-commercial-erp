import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const approvalPage = read("../app/approvals/work-orders/page.tsx");
const approvalApi = read("../app/api/approvals/work-orders/route.ts");
const pdfRoute = read("../app/api/work-orders/[id]/generated-pdf/route.ts");
const createRoute = read("../app/api/work-orders/create/route.ts");
const sync = read("../lib/workOrderPilotDriveSync.server.ts");

assert.match(approvalApi, /creation_request_id/);
assert.match(approvalPage, /Review Work Order PDF/);
assert.match(approvalPage, /generated-pdf/);
assert.match(approvalPage, /response\.blob\(\)/);
assert.match(createRoute, /work_order_documents/);
assert.match(createRoute, /structured-pilot/);
assert.match(pdfRoute, /requireAnyPermission/);
assert.match(pdfRoute, /wo_approval/);
assert.match(pdfRoute, /loadApprovalScope/);
assert.match(pdfRoute, /approvalScope\.assignments/);
assert.match(sync, /createWorkOrderDriveFolder/);
assert.match(sync, /existingDriveFile/);
assert.match(sync, /drive_sync_key: "pilot-generated-pdf"/);
assert.match(sync, /onConflict: "work_order_id,drive_sync_key"/);
assert.match(sync, /pilot_drive_sync_status: "succeeded"/);

console.log("Work Order Pilot pre-approval review and post-approval sync contract passed.");
