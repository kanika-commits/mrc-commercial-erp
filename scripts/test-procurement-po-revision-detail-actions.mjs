import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
assert.match(page, /View Comparison \/ Redline PDF/);
assert.match(page, /pdf\?comparison=1/);
assert.match(page, /R-\{previous\?\.revision_no/);
assert.match(page, /purchase-orders\/\$\{row\.previous_revision_id\}/);
assert.match(route, /searchParams\.get\("comparison"\) === "1"/);
assert.match(route, /if \(Number\(data\.revision_no \|\| 0\) > 0 && data\.previous_revision_id\)/);
console.log("PO revision detail/history actions: PASS");
