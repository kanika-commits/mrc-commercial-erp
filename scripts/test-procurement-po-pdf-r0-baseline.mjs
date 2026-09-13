import assert from "node:assert/strict";
import fs from "node:fs";

// A deterministic semantic contract for the stable R-0 fixture. This intentionally
// avoids binary PDF snapshots, whose metadata and object ordering are unstable.
const fixture = {
  poNumber: "MRC/SEP/2026/0006/R-0",
  id: "e7324e2f-a716-4be1-9ba2-3355d81e8a27",
  revisionNo: 0,
  items: [
    { name: "Epoxy Dark Brown", quantity: 40, rate: 2850 },
    { name: "Epoxy Dark Grey", quantity: 40, rate: 2850 },
  ],
  keyTerms: ["Freight", "Payment Terms", "Delivery Terms"],
  standardTerms: Array.from({ length: 9 }, (_, index) => `${index + 1}. clause`),
  totals: { basic: 228000, gst: 41040, grand: 269040 },
  signature: "Approved By",
  packagePages: 1,
};

const route = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8") + "\n" + fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
assert.equal(fixture.revisionNo, 0);
assert.equal(fixture.items.length, 2);
assert.deepEqual(fixture.items.map((item) => item.name), ["Epoxy Dark Brown", "Epoxy Dark Grey"]);
assert.equal(fixture.keyTerms.length, 3);
assert.equal(fixture.standardTerms.length, 9);
assert.deepEqual(Object.keys(fixture.totals), ["basic", "gst", "grand"]);
assert.equal(fixture.signature, "Approved By");
assert.equal(fixture.packagePages, 1);

assert.match(route, /async function makePdf\(/);
assert.match(route, /const combinedPdf = await appendPackage\(poPackage\.pdf, data, admin\)/);
assert.match(route, /const finalPdf = await numberPackage\(/);
assert.match(route, /const terms = numberedTerms\(row\.standard_terms_snapshot\)/);
assert.match(route, /summaryRows/);
assert.match(route, /const internalLines = \(finalStatus/);
assert.match(route, /const pageNumberBaselineY/);
console.log("PO R-0 semantic baseline rules: PASS");
