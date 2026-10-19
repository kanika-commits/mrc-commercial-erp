import assert from "node:assert/strict";
import fs from "node:fs";

const matrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const userPermissions = fs.readFileSync("app/admin/users/[id]/page.tsx", "utf8");
const rolePermissions = fs.readFileSync("app/admin/permissions/page.tsx", "utf8");
const creditApi = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");
const itemApi = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");

assert.match(matrix, /credit_notes: \["view", "add", "edit", "delete", "approve", "reject", "export"\]/);
assert.doesNotMatch(matrix, /credit_note_approval:/);
assert.match(visibility, /module_name: "Credit Notes"/);
assert.match(visibility, /module_name: "Work Order Item Master"/);
assert.match(visibility, /permission_module_code: "procurement_items"/);
assert.match(userPermissions, /visiblePermissionKeysForSave/);
assert.match(rolePermissions, /visiblePermissionKeysForSave/);
assert.match(creditApi, /requirePermission\(request, "credit_notes"/);
assert.match(itemApi, /ITEM_MODULE = "procurement_items"|ITEM_MODULE/);

console.log("Credit Note and Work Order Item Master permission-screen mapping passed.");
