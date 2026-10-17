import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const landing = fs.readFileSync("app/forms/pilot/page.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const workOrders = fs.readFileSync("app/work-orders/page.tsx", "utf8");

assert.match(shell, /navLeaf\("Work Order Forms"/);
assert.match(landing, /\/work-orders\/new\/structured/);
assert.match(modulePage, /module_name: "Work Order Forms"/);
assert.match(modulePage, /route: "\/forms\/work-orders"/);
assert.match(modulePage, /can\(permissions, "work_orders", "add"\)/);
assert.match(workOrders, /New Work Order PDF Pilot/);
assert.match(workOrders, /pilotOnly \? "\/work-orders\/new\/structured" : "\/work-orders\/new"/);

console.log("Work Order Form navigation contract: PASS");
