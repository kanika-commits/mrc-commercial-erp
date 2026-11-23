import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const driveSync = fs.readFileSync("lib/workOrderPilotDriveSync.server.ts", "utf8");
const documents = fs.readFileSync("app/api/work-orders/documents/route.ts", "utf8");

assert.match(page, /isDraft \? "Draft\/reviewed PDF" : "Official approved PDF"/);
assert.match(page, /!isApproved && loadedDocumentsByWorkOrder\[wo\.id\]/);
assert.match(page, /\.filter\(\(document\) => document\.drive_sync_key !== "pilot-reviewed-pdf"\)/);
assert.doesNotMatch(page, /isApproved \? "pilot-generated-pdf" : "pilot-reviewed-pdf"/);
assert.match(page, /officialPackageName\(wo\.wo_number\)/);
assert.match(page, /reviewedPackageName\(wo\.wo_number\)/);
assert.match(documents, /drive_sync_key/);
assert.match(driveSync, /pilot-generated-pdf/);
assert.match(driveSync, /contractor_docs_folder_id/);
assert.match(driveSync, /existingPdfDocument\s*\?/);
assert.match(driveSync, /status: "unavailable"/);

console.log("Approved Work Order documentation visibility contract passed.");
