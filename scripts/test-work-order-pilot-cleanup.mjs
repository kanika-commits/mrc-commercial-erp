import assert from "node:assert/strict";
import fs from "node:fs";

const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const formPage = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const draftHelper = fs.readFileSync("lib/workOrderPilotDraft.client.ts", "utf8");
const legacyPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");

assert.doesNotMatch(modulePage, /module_name: "Work Order PDF Pilot"/);
assert.doesNotMatch(modulePage, /route: "\/work-orders\/new\/structured"/);
assert.match(shell, /navLeaf\("Work Order Forms", "work_orders", "\/forms\/work-orders"\)/);
assert.match(formsPage, /<WorkOrdersPage pilotOnly \/>/);
assert.match(formPage, /const explicitlyResuming = Boolean\(draftId \|\| revisionId \|\| returningFromPreview\)/);
assert.match(formPage, /if \(!explicitlyResuming\) clearWorkOrderPilotDraft\(\)/);
assert.match(formPage, /returningFromPreview \? getWorkOrderPilotDraft\(\) : null/);
assert.match(formPage, /if \(!draftId\) return/);
assert.match(formPage, /apiFetch\(`\/api\/work-orders\/drafts\/\$\{draftId\}`\)/);
assert.match(formPage, /if \(!revisionId \|\| !revisionWorkOrderId\) return/);
assert.match(draftHelper, /let draft: WorkOrderPilotDraft \| null = null/);
assert.match(draftHelper, /export function clearWorkOrderPilotDraft\(\)/);
assert.match(legacyPage, /href=\{pilotOnly \? "\/work-orders\/new\/structured" : "\/work-orders\/new"\}/);
assert.match(legacyPage, /loadDocumentsForWorkOrder\(wo\.id\)/);

console.log("Work Order Pilot cleanup contract: PASS");
