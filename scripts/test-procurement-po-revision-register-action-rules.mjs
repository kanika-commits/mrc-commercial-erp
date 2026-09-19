import assert from "node:assert/strict";
import fs from "node:fs";

const register = fs.readFileSync("app/purchase/purchase-orders/page.tsx", "utf8");
const detail = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const api = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");

assert.match(register, /row\.po_number/);
assert.match(register, /row\.revision_indicator/);
assert.match(register, /canCreateRevision\(row\)/);
assert.match(register, /\+ Revised PO/);
assert.match(register, /Create a new revision of this approved PO/);
assert.doesNotMatch(register, /<Pencil\b/);
assert.doesNotMatch(register, /import[^\n]*\bPencil\b/);
assert.match(register, /row\.status === "approved"/);
assert.match(register, /superseded_by_revision_id/);
assert.match(register, /api\/procurement\/purchase-orders\/\$\{row\.id\}\/revision/);
assert.match(register, /href=\{`\/purchase\/purchase-orders\/\$\{row\.id\}`\}/);
assert.match(register, /statusLabel\(row\.status\)/);
assert.match(register, /signed_po_document/);
assert.match(api, /const allPurchaseOrders = data \|\| \[\]/);
assert.match(api, /const families = new Map/);
assert.match(api, /revision_indicator: open \? "Revision in Progress"/);
assert.match(api, /const selected = open \|\| effective/);
assert.doesNotMatch(detail, /\{canCreateRevision &&/);
assert.doesNotMatch(detail, /Revised PO/);

console.log("PO register revision action rules passed.");
