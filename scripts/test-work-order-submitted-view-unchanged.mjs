import assert from "node:assert/strict";
import fs from "node:fs";

const register = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const detail = fs.readFileSync("app/work-orders/[id]/page.tsx", "utf8");

assert.match(register, /: \(pilotOnly \? `\/work-orders\/\$\{wo\.id\}\?from=forms-work-orders` : `\/work-orders\/\$\{wo\.id\}`\)/);
assert.doesNotMatch(detail, /api\/work-orders\/drafts/);
assert.match(detail, /api\/work-orders\/\$\{encodeURIComponent\(workOrderId\)\}\/details/);
assert.match(detail, /api\/work-orders\/\$\{workOrderId\}\/generated-pdf/);
assert.match(detail, /api\/work-orders\/documents\?work_order_id/);

console.log("Submitted and approved Work Order viewing contract passed.");
