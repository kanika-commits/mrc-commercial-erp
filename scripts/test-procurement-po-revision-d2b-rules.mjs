import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8") + "\n" + fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
assert.match(route, /revisionComparison/);
assert.doesNotMatch(route, /renderRevisionComparisons/);
assert.doesNotMatch(route, /REVISION CHANGES/);
assert.doesNotMatch(route, /TERMS REDLINE/);
assert.match(route, /drawRedline\(oldValue/);
assert.match(route, /drawRedline\(newValue/);
assert.match(route, /key_terms/);
assert.match(route, /standard_terms_snapshot/);
assert.match(route, /numberedTerms\(row\.standard_terms_snapshot\)/);
assert.match(route, /numberPackage\(protectedPdf/);
console.log("PO revision D2B commercial and terms redline rules: PASS");
