import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/drafts/[id]/page.tsx", "utf8");
const documentsApi = fs.readFileSync("app/api/work-orders/documents/route.ts", "utf8");
const draftApi = fs.readFileSync("app/api/work-orders/drafts/[id]/route.ts", "utf8");

assert.match(page, /\/api\/work-orders\/documents\?work_order_id=/);
assert.match(page, /data-testid="work-order-draft-supporting-documents"/);
assert.match(page, /Loading supporting documents/);
assert.match(page, /No supporting documents are attached/);
assert.match(page, /Retry supporting documents/);
assert.match(page, /signed_url/);
assert.match(page, /window\.open\(document\.signed_url/);
assert.match(page, /useEffect\(\(\) => \{ void loadDocuments\(\); \}, \[params\.id\]\)/);
assert.match(documentsApi, /work_order_documents/);
assert.match(documentsApi, /createSignedUrl/);
assert.match(documentsApi, /loadActorOrganizationScope/);
assert.match(documentsApi, /isInOrganizationScope/);
assert.match(draftApi, /eq\("id", id\)/);
assert.match(draftApi, /eq\("approval_status", "draft"\)/);

console.log("Work Order draft supporting-document display contract passed.");
