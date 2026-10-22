import assert from "node:assert/strict";
import fs from "node:fs";

const guard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const api = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const access = fs.readFileSync("lib/serverProcurementAccess.ts", "utf8");
const permission = fs.readFileSync("lib/permissionMatrix.ts", "utf8");

assert.match(guard, /const explicitSettingsAccess = settingsRouteAccess\(pathname, access\)/);
assert.match(guard, /pathname === "\/work-orders\/item-masters"\) return can\(access\.permissions, "procurement_items", "view"\)/);
assert.match(shell, /navLeaf\("Work Order Item Master", "procurement_items", "\/work-orders\/item-masters"\)/);
assert.match(api, /requireProcurementPermission\(request, ITEM_MODULE, "view"\)/);
assert.match(access, /ITEM_MODULE = "procurement_items"/);
assert.match(permission, /procurement_items: \["view", "add", "edit", "delete", "export"\]/);
assert.doesNotMatch(guard, /work_order_item_masters/);
assert.doesNotMatch(shell, /Work Order Item Master", "work_order_item_masters"/);
assert.doesNotMatch(api, /organization_id:\s*body\.organization_id/);

console.log("Work Order Item Master permission access regression: PASS");
