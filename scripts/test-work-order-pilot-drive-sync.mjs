import assert from "node:assert/strict";
import fs from "node:fs";

const approvalRoute = fs.readFileSync("app/api/work-orders/[id]/route.ts", "utf8");
const sync = fs.readFileSync("lib/workOrderPilotDriveSync.server.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610030001_work_order_pilot_drive_sync.sql", "utf8");
const preview = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");

assert.match(approvalRoute, /requirePermission\(request, "wo_approval", "approve"\)/);
assert.match(approvalRoute, /approval_status: "approved"/);
assert.match(approvalRoute, /syncPilotWorkOrderToDrive\(admin, id\)/);
assert.match(approvalRoute, /drive_sync: driveSync/);

assert.match(sync, /creation_request_id/);
assert.match(sync, /if \(!identity \|\| !identity\.creation_request_id\) return \{ kind: "skip"/);
assert.match(sync, /identity\.approval_status[^\n]*approved/);
assert.match(sync, /createWorkOrderDriveFolder\(orderForFolder\.wo_number\)/);
assert.match(sync, /listDriveFolderFiles/);
assert.match(sync, /uploadDriveFile/);
assert.match(sync, /workOrderPdfFileName/);
assert.match(sync, /pilot-generated-pdf/);
assert.match(sync, /pilot-supporting-\$\{String\(index \+ 1\)\.padStart\(4, "0"\)\}/);
assert.match(sync, /Supporting \$\{String\(index \+ 1\)\.padStart\(2, "0"\)\}/);
assert.match(sync, /pilot_drive_sync_status: "running"/);
assert.match(sync, /pilot_drive_sync_status: "succeeded"/);
assert.match(sync, /pilot_drive_sync_status: "failed"/);
assert.match(sync, /pilot_drive_sync_status === "running"/);
assert.match(sync, /eq\("pilot_drive_sync_started_at", current\.pilot_drive_sync_started_at\)/);
assert.match(sync, /onConflict: "work_order_id,drive_sync_key"/);
assert.match(sync, /status: "unavailable"/);

assert.match(migration, /add column if not exists pilot_drive_sync_status/);
assert.match(migration, /add column if not exists drive_sync_key/);
assert.match(migration, /unique index if not exists work_order_documents_drive_sync_key_uidx/);
assert.match(migration, /Prepared only/);

assert.match(create, /creation_request_id/);
assert.doesNotMatch(create, /createWorkOrderDriveFolder|uploadDriveFile/);
assert.doesNotMatch(preview, /createWorkOrderDriveFolder|uploadDriveFile/);
assert.doesNotMatch(preview, /\.from\("work_orders"\)\.(insert|update|upsert|delete)/);

console.log("Work Order Pilot approval-to-Drive contract passed.");
