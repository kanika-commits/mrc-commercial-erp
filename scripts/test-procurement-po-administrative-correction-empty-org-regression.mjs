import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/administrative-correction/route.ts", "utf8");

assert.match(route, /const organizationId = auth\.organizations\?\.\[0\];/);
assert.match(route, /let completedQuery = admin\.from\("procurement_purchase_order_artifact_current"\)/);
assert.match(route, /if \(organizationId\) completedQuery = completedQuery\.eq\("organization_id", organizationId\);/);
assert.doesNotMatch(route, /eq\("organization_id", auth\.organizations\?\.\[0\] \|\| ""\)/);

const buildCompletedLookup = (organizationId) => {
  const filters = ["purchase_order_id", "idempotency_key"];
  if (organizationId) filters.push("organization_id");
  return filters;
};

assert.deepEqual(buildCompletedLookup(""), ["purchase_order_id", "idempotency_key"]);
assert.deepEqual(buildCompletedLookup("org-uuid"), ["purchase_order_id", "idempotency_key", "organization_id"]);
console.log("PASS: empty organization scope does not become an empty UUID filter");
