import assert from "node:assert/strict";
import fs from "node:fs";

const matrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const visibility = fs.readFileSync("lib/permissionVisibility.ts", "utf8");
const guard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const configApi = fs.readFileSync("app/api/procurement/requisitions/configuration/route.ts", "utf8");
const approveApi = fs.readFileSync("app/api/procurement/requisitions/[id]/approve/route.ts", "utf8");
const rejectApi = fs.readFileSync("app/api/procurement/requisitions/[id]/send-back/route.ts", "utf8");
const page = fs.readFileSync("app/purchase/requisitions/configuration/page.tsx", "utf8");

assert.match(matrix, /purchase_requisition_approval_configuration: \["view", "edit"\]/);
assert.match(visibility, /purchase_requisition_approval_configuration:[\s\S]+visible_actions: \["view", "edit"\]/);
assert.match(guard, /purchase_requisition_approval_configuration.*view/);
assert.match(shell, /navLeaf\("Indent Approval Policy", "purchase_requisition_approval_configuration"/);
assert.match(configApi, /requireProcurementPermission\(request, MODULE, "view"\)/);
assert.match(configApi, /requireProcurementPermission\(request, MODULE, "edit"\)/);
assert.match(approveApi, /requireProcurementPermission\(request, APPROVAL_MODULE, "approve"\)/);
assert.match(rejectApi, /requireProcurementPermission\(request, APPROVAL_MODULE, "reject"\)/);
assert.match(page, /data\.can_edit/);
assert.doesNotMatch(matrix, /purchase_requisition_approval_configuration: \[[^\]]*delete/);
console.log("Indent Approval permission controls regression passed.");
