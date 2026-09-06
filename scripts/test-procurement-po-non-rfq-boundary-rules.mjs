import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const post = read("app/api/procurement/purchase-orders/route.ts");
const lookups = read("app/api/procurement/purchase-orders/lookups/route.ts");
const createPage = read("app/purchase/purchase-orders/new/page.tsx");
const register = read("app/purchase/purchase-orders/page.tsx");
const detail = read("app/purchase/purchase-orders/[id]/page.tsx");
const documents = read("app/api/procurement/purchase-orders/[id]/documents/route.ts");

for (const source of [post, lookups, createPage, register, detail]) {
  assert.doesNotMatch(source, /procurement_rfq|final_selection|final selection|negotiation/);
}
assert.match(post, /sourceType = text\(body\.source_type\) \|\| "direct"/);
assert.match(post, /sourceType !== "direct" && sourceType !== "indent"/);
assert.match(lookups, /indents/);
assert.doesNotMatch(lookups, /final_selections|procurement_rfq/);
assert.match(createPage, /type Source = "direct" \| "indent"/);
assert.match(createPage, /Direct Purchase/);
assert.match(createPage, /From Material Indent/);
assert.doesNotMatch(createPage, /Final Selection|final_selection|\/api\/procurement\/rfqs/);
assert.doesNotMatch(register, /final_selection|Final Selection/);
assert.doesNotMatch(detail, /final_selection|Final Selection/);
assert.doesNotMatch(documents, /documentType.*quotation|"quotation"/);
assert.match(documents, /procurement-rfq-quotation-documents/, "The established private shared procurement bucket remains the document storage boundary");
console.log("Non-RFQ Purchase Order boundary rules passed");
