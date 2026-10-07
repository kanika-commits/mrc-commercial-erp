import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8") + "\n" + fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
assert.match(route, /revisionComparison/);
assert.match(route, /function drawRedline|const drawRedline/);
assert.match(route, /strike/);
assert.match(route, /drawChanged/);
assert.match(route, /revision_line_key/);
assert.match(route, /state: "removed"/);
assert.match(route, /state: "added"/);
assert.match(route, /strike: true/);
assert.match(route, /numberPackage\(protectedPdf/);
console.log("PO revision D2A redline primitives: PASS");
