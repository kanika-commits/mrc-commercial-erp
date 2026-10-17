import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/[id]/page.tsx", "utf8");
assert.match(page, /actionName === "submit"\) \{ router\.push\("\/purchase\/purchase-orders\?message=submitted"\)/);
assert.match(page, /actionName === "approve"\) \{ router\.push\("\/purchase\/purchase-orders\?message=approved"\)/);
assert.match(page, /catch \(error: any\) \{ setMessage\(error\.message\); \}/);
console.log("PO approval navigation regression passed.");
