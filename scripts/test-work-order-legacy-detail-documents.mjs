import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/documents/route.ts", "utf8");

assert.match(page, /\/api\/work-orders\/documents\?work_order_id=/);
assert.match(page, /Load Work Order files/);
assert.match(page, /onClick=\{loadDocuments\}/);
assert.match(page, /documentsLoaded/);
assert.match(page, /setDocuments\(documentResult\.documents \|\| \[\]\)/);
assert.match(page, /documents\.map\(\(doc\) =>/);
assert.match(page, /doc\.file_name \|\| "Work Order file"/);
assert.match(page, /document\.signed_url/);
assert.match(page, /onClick=\{\(\) => openDocument\(doc\)\}/);
assert.match(route, /from\("work_order_documents"\)/);
assert.match(route, /file_name, file_url, file_path, uploaded_at/);
assert.match(route, /createSignedUrl\(path, 60 \* 10\)/);
assert.match(route, /signed_url: document\.file_url/);
assert.doesNotMatch(page, /work_order_files/);
assert.doesNotMatch(route, /work_order_files/);

console.log("Legacy Work Order detail documents contract passed.");
