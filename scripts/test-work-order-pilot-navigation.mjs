import assert from "node:assert/strict";
import fs from "node:fs";

const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const pilotPage = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(modulePage, /module_name: "Work Order Forms"/);
assert.match(modulePage, /route: "\/forms\/work-orders"/);
assert.match(modulePage, /can\(permissions, "work_orders", "add"\)/);
const projectManagement = appShell.match(/topNested\(\s*"module-project-management"[\s\S]*?\n\s*\),\n\s*topNested\(/)?.[0] ?? "";
const purchase = appShell.match(/topNested\(\s*"module-purchase"[\s\S]*?\n\s*\),\n\s*topNested\(/)?.[0] ?? "";
assert.doesNotMatch(projectManagement, /Work Order Forms/);
assert.match(purchase, /navActionLeaf\("Work Order Forms", "work_orders", "add", "\/forms\/work-orders"\)/);
assert.match(appShell, /navLeaf\("Work Orders", "work_orders", "\/work-orders"\)/);
assert.match(appShell, /navLeaf\("Work Order Approval", "wo_approval", "\/approvals\/work-orders"\)/);
assert.match(pilotPage, /Create Work Order/);

console.log("Work Order Pilot navigation contract passed.");
