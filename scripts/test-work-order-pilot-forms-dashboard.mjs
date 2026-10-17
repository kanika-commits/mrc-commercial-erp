import assert from "node:assert/strict";
import fs from "node:fs";

const registerPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const pilotLanding = fs.readFileSync("app/forms/pilot/page.tsx", "utf8");

assert.match(shell, /navLeaf\("Work Order Forms"/);
assert.match(formsPage, /<WorkOrdersPage pilotOnly \/>/);
assert.match(modulePage, /module_name: "Work Order Forms"/);
assert.match(modulePage, /route: "\/forms\/work-orders"/);
assert.match(modulePage, /can\(permissions, "work_orders", "add"\)/);
assert.match(registerPage, /export function WorkOrdersPage\(\{ pilotOnly = false \}/);
assert.match(registerPage, /pilotOnly \? "\/work-orders\/new\/structured" : "\/work-orders\/new"/);
assert.match(registerPage, /pilotOnly\) params\.set\("pilot_only", "1"\)/);
assert.match(registerPage, /Load documents/);
assert.match(registerPage, /openDocument\(document\)/);
assert.match(registerPage, /Load documents/);
assert.match(pilotLanding, /href="\/work-orders\/new\/structured"/);
assert.doesNotMatch(pilotLanding, /ra-bill|RA Bill/i);

console.log("Work Order Pilot dashboard contract: PASS");
