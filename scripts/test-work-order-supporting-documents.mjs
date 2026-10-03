import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const previewPage = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const preview = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const helper = fs.readFileSync("lib/workOrderSupportingDocuments.server.ts", "utf8");
const packageHelper = fs.readFileSync("lib/workOrderPdfPackage.server.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

assert.match(page, /Supporting Documents/);
assert.match(page, /<input type="file" multiple onChange/);
assert.match(page, /Any file type is accepted/);
assert.match(page, /supportingDocuments\.map/);
assert.match(page, /setSupportingDocuments\(\(current\) => current\.filter/);
assert.match(page, /previewForm\.append\("supporting_documents"/);
assert.match(page, /setWorkOrderPilotDraft/);
assert.match(page, /router\.push\("\/work-orders\/new\/structured\/preview"\)/);
assert.doesNotMatch(page, /apiFetch\("\/api\/work-orders\/create"/);

assert.match(previewPage, /getWorkOrderPilotDraft/);
assert.match(previewPage, /Back to Edit/);
assert.match(previewPage, /iframe title="Work Order PDF preview"/);
assert.match(previewPage, /submitForm\.append\("supporting_documents"/);
assert.match(previewPage, /apiFetch\("\/api\/work-orders\/create"/);
assert.match(previewPage, /creation_request_id/);
assert.doesNotMatch(previewPage, /apiFetch\("\/api\/work-orders\/preview"/);

assert.match(preview, /request\.formData\(\)/);
assert.match(preview, /validateWorkOrderSupportingFiles\(supportingFiles\)/);
assert.match(preview, /appendWorkOrderSupportingPdfs\(rendered, supportingFiles\)/);
assert.match(preview, /persisted: false/);
assert.match(preview, /addWorkOrderDraftWatermark/);
assert.match(preview, /approval_status: "draft"/);
assert.doesNotMatch(preview, /\.from\("work_orders"\)\.(insert|update|upsert|delete)/);
assert.doesNotMatch(preview, /\.from\("work_order_documents"\)/);

assert.match(helper, /for \(const file of files\)/);
assert.match(helper, /output\.copyPages\(source, source\.getPageIndices\(\)\)/);
assert.match(helper, /output\.addPage\(page\)/);
assert.match(helper, /imageFormat/);
assert.match(helper, /Supporting attachment/);
assert.match(helper, /original file is attached/);
assert.match(packageHelper, /options\.plain \? `\$\{index \+ 1\} of \$\{total\}`/);
assert.match(packageHelper, /pdf\.getPageCount\(\)/);
assert.match(packageHelper, /const y = Math\.min\(page\.getHeight\(\) - 24, 110\)/);
assert.match(packageHelper, /page\.drawText\("DRAFT"/);
assert.match(renderer, /const LEFT = 28/);
assert.match(renderer, /const RIGHT = 567/);
assert.doesNotMatch(renderer, /Page \$\{index \+ 1\} of \$\{pages\.length\}/);
assert.match(renderer, /Vendor Acceptance/);
assert.match(renderer, /Created By/);
assert.match(renderer, /Approved By/);
assert.match(renderer, /created_by_email/);
assert.match(renderer, /approved_by_email/);
assert.match(renderer, /`Email: \$\{creatorEmail\}`/);
assert.match(renderer, /`Email: \$\{approverEmail\}`/);
assert.doesNotMatch(renderer, /`ID: \$\{creatorId\}`/);
assert.doesNotMatch(renderer, /`ID: \$\{approverId\}`/);
assert.match(renderer, /Signature: ____________________/);
assert.match(renderer, /const clauseBlocks/);
assert.match(renderer, /availableLines/);

assert.match(create, /work-order-documents/);
assert.match(create, /created_by: auth\.user\.id/);
assert.match(create, /structured-pilot\//);
assert.match(create, /\.from\("work_order_documents"\)\.insert/);
assert.doesNotMatch(create, /googleDrive|uploadDriveFile|createWorkOrderDriveFolder/);

console.log("Work Order Pilot supporting-document contract passed.");
