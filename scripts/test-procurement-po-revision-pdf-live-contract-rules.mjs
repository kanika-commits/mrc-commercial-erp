import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8") + "\n" + fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const detail = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const detailApi = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");

assert.doesNotMatch(route, /REVISION CHANGES/);
assert.doesNotMatch(route, /TERMS REDLINE/);
assert.match(route, /comparisonRequested/);
assert.match(route, /revisionComparison/);
assert.match(route, /drawRedline/);
assert.match(route, /numberPackage\(protectedPdf/);
assert.match(route, /Revision: R-\$\{row\.revision_no\}/);
assert.doesNotMatch(route, /Previous Revision:/);
assert.match(detail, /async function openRevisionPdf\(revisionId: string\)/);
assert.match(detail, /Authorization: `Bearer \$\{token\}`/);
assert.match(detail, /openRevisionPdf\(revision\.id\)/);
assert.match(detail, /View Comparison \/ Redline PDF/);
assert.match(detail, /row\.previous_revision_id/);
assert.match(detail, /R-\{previous\?\.revision_no/);
assert.match(detail, /revision_history/);
assert.match(detail, /href=\{`\/purchase\/purchase-orders\/\$\{row\.previous_revision_id\}`\}/);
assert.match(detailApi, /revisionHistory/);
assert.match(detailApi, /revision_family_id/);
assert.doesNotMatch(detail, /<a href=\{`\/api\/procurement\/purchase-orders\/\$\{revision\.id\}\/pdf`\}/);

console.log("PO revision PDF live-contract rules passed.");
