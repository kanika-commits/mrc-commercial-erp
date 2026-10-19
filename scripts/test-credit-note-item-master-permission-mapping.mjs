import assert from "node:assert/strict";
import fs from "node:fs";

const matrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const userPermissions = fs.readFileSync("app/admin/users/[id]/page.tsx", "utf8");
const rolePermissions = fs.readFileSync("app/admin/permissions/page.tsx", "utf8");
const creditApi = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");
const itemApi = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const authGuard = fs.readFileSync("components/AuthGuard.tsx", "utf8");

assert.match(matrix, /credit_notes: \["view", "add", "edit", "delete", "approve", "reject", "export"\]/);
assert.doesNotMatch(matrix, /credit_note_approval:/);
assert.match(visibility, /module_name: "Credit Notes"/);
assert.match(visibility, /module_name: "Masters - Work Order Item Master"/);
assert.match(matrix, /work_order_item_master: \["view", "add", "edit", "delete", "export"\]/);
assert.match(visibility, /work_order_item_master: \{ visible_group: "Settings", visible_name: "Masters - Work Order Item Master"/);
assert.match(shell, /navLeaf\("Work Order Item Master", "work_order_item_master", "\/work-orders\/item-masters"\)/);
assert.match(modulePage, /module_code: "work_order_item_master"/);
assert.match(authGuard, /pathname === "\/work-orders\/item-masters"\) return can\(access\.permissions, "work_order_item_master", "view"\)/);
assert.match(userPermissions, /visiblePermissionKeysForSave/);
assert.match(rolePermissions, /visiblePermissionKeysForSave/);
assert.match(creditApi, /requirePermission\(request, "credit_notes"/);
assert.match(itemApi, /const ITEM_MODULE = "work_order_item_master"/);

console.log("Credit Note and Work Order Item Master permission-screen mapping passed.");
