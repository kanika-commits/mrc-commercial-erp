import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/item-masters/page.tsx", "utf8");
const editPage = fs.readFileSync("app/work-orders/item-masters/[id]/edit/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const matrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");

assert.match(page, /work-orders\/item-masters\/\$\{item\.id\}\/edit/);
assert.match(page, /can\(access\?\.permissions \|\| \[\], "procurement_items", "edit"\)/);
assert.match(editPage, /Edit Work Order Item Master/);
assert.match(editPage, /method: "PATCH"/);
assert.match(editPage, /existing Work Order snapshots remain unchanged/);
assert.match(route, /export async function PATCH/);
assert.match(route, /requireProcurementPermission\(request, ITEM_MODULE, "edit"\)/);
assert.match(route, /\.eq\("organization_id", organizationId\)/);
assert.match(route, /\.neq\("status", "deleted"\)/);
assert.match(route, /updated_by: auth\.user\.id/);
assert.doesNotMatch(route, /work_order_items.*update/);
assert.match(authGuard, /if \(pathname\.includes\("\/edit"\)\) return "edit"/);
assert.match(matrix, /procurement_items: \["view", "add", "edit", "delete", "export"\]/);
assert.match(visibility, /procurement_items: \{ visible_group: "Settings"/);

console.log("Work Order Item Master edit permission, scope, validation, and snapshot rules: PASS");
