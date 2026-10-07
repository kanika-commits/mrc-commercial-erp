import assert from "node:assert/strict";
import fs from "node:fs";

const approved = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const supporting = fs.readFileSync("lib/workOrderSupportingDocuments.server.ts", "utf8");
const numbering = fs.readFileSync("lib/workOrderPdfPackage.server.ts", "utf8");

assert.match(approved, /from\("work_order_documents"\)/);
assert.match(approved, /filter\(\(row: any\) => row\.drive_sync_key !== "pilot-generated-pdf"\)/);
assert.match(approved, /admin\.storage\.from\("work-order-documents"\)\.download/);
assert.match(approved, /appendWorkOrderSupportingPdfs\(bytes, supportingFiles\)/);
assert.match(supporting, /PDFDocument\.load\(workOrderPdf\)/);
assert.match(supporting, /copyPages\(source, source\.getPageIndices\(\)\)/);
assert.match(supporting, /output\.addPage\(\[595, 842\]\)/);
assert.match(numbering, /const total = pdf\.getPageCount\(\)/);
assert.match(numbering, /pdf\.getPages\(\)\.forEach/);
console.log("Work Order PDF package attachment/page-count contract: PASS");
