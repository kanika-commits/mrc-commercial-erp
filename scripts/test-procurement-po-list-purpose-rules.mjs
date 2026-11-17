import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");

assert.match(page, /Purchase Purpose/);
assert.match(page, /row\.purpose \|\| row\.commercial_snapshot\?\.purpose/);
assert.match(route, /from\("procurement_purchase_orders"\)\.select\("\*.*purpose/s);

console.log("Purchase Order list Purchase Purpose rules passed");
