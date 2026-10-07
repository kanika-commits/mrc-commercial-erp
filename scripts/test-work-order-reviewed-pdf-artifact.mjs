import assert from "node:assert/strict";
import fs from "node:fs";

const createRoute = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const approvalLoader = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const submitPage = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");

assert.match(submitPage, /reviewed_pdf_base64/);
assert.match(submitPage, /creation_request_id: draft\.creationRequestId/);
assert.match(createRoute, /PDFDocument\.load\(reviewedPdfBytes\)/);
assert.match(createRoute, /drive_sync_key: REVIEWED_PDF_KEY/);
assert.match(createRoute, /file_url: reviewedArtifactPath/);
assert.match(createRoute, /file_path: reviewedArtifactPath/);
assert.doesNotMatch(createRoute, /drive_sync_key: REVIEWED_PDF_KEY[^\n]*file_url: null/);
assert.match(createRoute, /upsert: false/);
assert.ok(createRoute.indexOf('storage.from(SUPPORTING_DOCUMENT_BUCKET).upload(reviewedArtifactPath') < createRoute.indexOf('from("work_orders").insert'), "reviewed artifact must be stored before the Work Order is created");
assert.match(createRoute, /id: proposedWorkOrderId/);
assert.match(createRoute, /no stored reviewed PDF artifact/);
assert.match(approvalLoader, /drive_sync_key === "pilot-reviewed-pdf"/);
assert.match(approvalLoader, /return bytes;/);
assert.match(approvalLoader, /creation_request_id\) throw new Error/);
assert.doesNotMatch(approvalLoader, /appendWorkOrderSupportingPdfs\(bytes, supportingFiles\).*pilot-reviewed-pdf/);
assert.match(approvalLoader, /PDFDocument\.load\(bytes\)/);

console.log("Work Order reviewed PDF artifact flow contract: PASS");
