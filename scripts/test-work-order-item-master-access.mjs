import assert from "node:assert/strict";
import fs from "node:fs";

const guard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const page = fs.readFileSync("app/work-orders/item-masters/page.tsx", "utf8");
const api = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const permission = fs.readFileSync("lib/permissionMatrix.ts", "utf8");

assert.match(guard, /pathname === "\/settings\/items"\) return can\(access\.permissions, "procurement_items", "view"\)/);
assert.match(guard, /if \(pathname === "\/work-orders\/item-masters"\) \{\s*return can\(access\.permissions, "procurement_items", "view"\);\s*\}/);
assert.match(shell, /navLeaf\("Work Order Item Master", "procurement_items", "\/work-orders\/item-masters"\)/);
assert.match(modulePage, /module_name: "Masters - Work Order Item Master"/);
assert.match(modulePage, /route: "\/work-orders\/item-masters"/);
assert.match(visibility, /module_name: "Work Order Item Master"/);
assert.match(visibility, /permission_module_code: "procurement_items"/);
assert.match(page, /\/api\/work-orders\/item-masters/);
assert.match(api, /requireProcurementPermission\(request, ITEM_MODULE, "view"\)/);
assert.match(api, /requireProcurementPermission\(request, ITEM_MODULE, "add"\)/);
assert.match(api, /requireProcurementPermission\(request, ITEM_MODULE, "delete"\)/);
assert.match(api, /resolveWriteOrganizationId/);
assert.match(permission, /procurement_items: \["view", "add", "edit", "delete", "export"\]/);

console.log("Work Order Item Master feature access contract passed.");
