import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/approvals/work-orders/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/documents/route.ts", "utf8");

assert.match(page, /const \[documents, setDocuments\] = useState<Map<string, any\[\]>>\(new Map\(\)\)/);
assert.match(page, /Load documents/);
assert.match(page, /onClick=\{\(\) => void loadDocuments\(wo\)\}/);
assert.match(page, /work-orders\/documents\?work_order_id=/);
assert.match(page, /documents\.get\(wo\.id\) \|\| \[\]/);
assert.match(page, /currentDocuments\.map\(\(document\) =>/);
assert.match(page, /document\.file_name \|\| "Work Order file"/);
assert.match(page, /document\.signed_url/);
assert.match(page, /!wo\.creation_request_id/);
assert.match(page, /wo\.creation_request_id/);
assert.match(route, /from\("work_order_documents"\)/);
assert.match(route, /\.in\("work_order_id", workOrderIds\)/);
assert.match(route, /signed_url: document\.file_url/);
assert.doesNotMatch(page, /work_order_files/);
assert.doesNotMatch(route, /work_order_files/);

console.log("Work Order approval documents contract passed.");
