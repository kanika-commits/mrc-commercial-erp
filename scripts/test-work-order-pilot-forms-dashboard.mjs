import assert from "node:assert/strict";
import fs from "node:fs";

const registerRoute = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");
const registerPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");

assert.match(shell, /navLeaf\("Work Order Forms", "work_orders", "\/forms\/work-orders"\)/);
assert.doesNotMatch(shell, /navActionLeaf\("Work Order PDF Pilot"/);
assert.match(modulePage, /module_name: "Work Order Forms"/);
assert.match(modulePage, /route: "\/forms\/work-orders"/);
assert.match(modulePage, /can\(permissions, "work_orders", "add"\)/);
assert.match(formsPage, /<WorkOrdersPage pilotOnly \/>/);
assert.match(registerPage, /export function WorkOrdersPage\(\{ pilotOnly = false \}/);
assert.match(registerPage, /pilotOnly \? "\/work-orders\/new\/structured" : "\/work-orders\/new"/);
assert.match(registerPage, /New Work Order PDF Pilot/);
assert.match(registerPage, /loadReviewedPackage/);
assert.match(registerPage, /generated-pdf/);
assert.match(registerPage, /loadedReviewedPackages/);
assert.match(registerRoute, /searchParams\.get\("pilot_only"\) === "1"/);
assert.match(registerRoute, /filters\.pilotOnly/);
assert.match(registerRoute, /not\("creation_request_id", "is", null\)/);
assert.match(registerPage, /href=\{pilotOnly \? "\/work-orders\/new\/structured" : "\/work-orders\/new"\}/);
assert.match(registerPage, /pilotOnly \? "New Work Order PDF Pilot" : "New Work Order"/);
assert.match(registerPage, /loadDocumentsForWorkOrder/);
assert.match(registerPage, /openDocument\(document\)/);
assert.doesNotMatch(registerPage, /pilotOnly[\s\S]{0,500}\/forms\/ra-bills/);

console.log("Work Order Pilot Forms dashboard contract: PASS");
