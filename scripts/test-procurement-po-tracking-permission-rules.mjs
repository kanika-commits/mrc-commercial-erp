import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const matrix = read("lib/permissionMatrix.ts");
const visibility = read("lib/permissionVisibility.ts");
const listApi = read("app/api/procurement/goods-receipts/route.ts");
const detailApi = read("app/api/procurement/goods-receipts/purchase-orders/[id]/route.ts");
const listPage = read("app/store/goods-receipts/page.tsx");
const detailPage = read("app/store/goods-receipts/purchase-orders/[id]/page.tsx");

assert.match(matrix, /procurement_goods_receipts: \["view", "add", "edit", "approve", "export"\]/);
assert.match(visibility, /procurement_goods_receipts: \{[^\n]*visible_name: "Purchase Order Tracking"/);
for (const source of [listApi, detailApi]) {
  assert.match(source, /requireProcurementPermission\(request, MODULE, "view"\)/);
  assert.match(source, /applyOrganizationAccess/);
  assert.match(source, /applyCompanySiteAccess/);
}
for (const source of [listPage, detailPage]) {
  assert.match(source, /hasGlobalAccess/);
  assert.match(source, /procurement_goods_receipts/);
  assert.match(source, /You do not have view access to Purchase Order Tracking/);
}
console.log("PO Tracking permission rules: PASS");
