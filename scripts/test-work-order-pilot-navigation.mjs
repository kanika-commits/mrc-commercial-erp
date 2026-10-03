import assert from "node:assert/strict";
import fs from "node:fs";

const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const pilotPage = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(modulePage, /module_name: "Work Order PDF Pilot"/);
assert.match(modulePage, /route: "\/work-orders\/new\/structured"/);
assert.match(modulePage, /can\(permissions, "work_orders", "add"\)/);
assert.match(appShell, /navActionLeaf\("Work Order PDF Pilot", "work_orders", "add", "\/work-orders\/new\/structured"\)/);
assert.match(appShell, /navLeaf\("Work Orders", "work_orders", "\/work-orders"\)/);
assert.match(appShell, /navLeaf\("Work Order Approval", "wo_approval", "\/approvals\/work-orders"\)/);
assert.match(pilotPage, /Create Work Order/);

console.log("Work Order Pilot navigation contract passed.");
