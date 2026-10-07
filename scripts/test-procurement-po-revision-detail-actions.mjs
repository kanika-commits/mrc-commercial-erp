import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const detailRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
assert.match(page, /View Comparison \/ Redline PDF/);
assert.match(page, /pdf\?comparison=1/);
assert.match(page, /R-\{previous\?\.revision_no/);
assert.match(page, /purchase-orders\/\$\{row\.previous_revision_id\}/);
assert.match(route, /searchParams\.get\("comparison"\) === "1"/);
assert.match(route, /const revisionPdfRequested = Number\(data\.revision_no \|\| 0\) > 0 && Boolean\(data\.previous_revision_id\)/);
assert.match(detailRoute, /eq\("revision_family_id", data\.revision_family_id\)/);
assert.match(detailRoute, /select\("id,po_number,revision_no,status,revision_family_id,previous_revision_id,superseded_by_revision_id/);
assert.match(detailRoute, /revision_history: result\.revisionHistory/);
console.log("PO revision detail/history actions: PASS");
