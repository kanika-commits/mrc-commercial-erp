import assert from "node:assert/strict";
import fs from "node:fs";

const registerRoute = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");
const registerPage = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const formsPage = fs.readFileSync("app/forms/work-orders/page.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const structuredForm = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const previewRoute = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");

assert.match(shell, /navActionLeaf\("Work Order Forms", "work_orders", "add", "\/forms\/work-orders"\)/);
const projectManagement = shell.match(/topNested\(\s*"module-project-management"[\s\S]*?\n\s*\),\n\s*topNested\(/)?.[0] ?? "";
const purchase = shell.match(/topNested\(\s*"module-purchase"[\s\S]*?\n\s*\),\n\s*topNested\(/)?.[0] ?? "";
assert.doesNotMatch(projectManagement, /Work Order Forms/);
assert.match(purchase, /navActionLeaf\("Work Order Forms", "work_orders", "add", "\/forms\/work-orders"\)/);
assert.doesNotMatch(shell, /"module-forms"/);
assert.doesNotMatch(shell, /navActionLeaf\("Work Order PDF Pilot"/);
assert.match(modulePage, /module_name: "Work Order Forms"/);
assert.match(modulePage, /route: "\/forms\/work-orders"/);
assert.match(modulePage, /groupCode === "purchase"[\s\S]+id: "purchase-work-order-forms"[\s\S]+module_group: "purchase"/);
assert.doesNotMatch(modulePage, /id: "project-work-order-forms"/);
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
const detailLinkExpression = /href=\{pilotOnly \? `\/work-orders\/\$\{wo\.id\}\?from=forms-work-orders` : `\/work-orders\/\$\{wo\.id\}`\}/g;
assert.equal((registerPage.match(detailLinkExpression) || []).length, 2, "Pilot and legacy registers both preserve the detail link origin");
assert.match(registerPage, detailLinkExpression, "Pilot register links preserve the Work Order Forms origin while legacy links retain their default path");
assert.match(registerPage, /loadDocumentsForWorkOrder/);
assert.match(registerPage, /openDocument\(document\)/);
assert.doesNotMatch(registerPage, /pilotOnly[\s\S]{0,500}\/forms\/ra-bills/);
assert.match(structuredForm, /WO Type/);
for (const type of ["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"]) {
  assert.match(structuredForm, new RegExp(type.replace(/[()]/g, "\\$&")));
}
for (const column of ["Item Header", "Description", "Unit", "Mode of Measurement", "Quantity", "Unit Rate", "GST %"]) {
  assert.match(structuredForm, new RegExp(column.replace(/[ %]/g, "\\$&")));
}
assert.match(structuredForm, /apiFetch\("\/api\/work-orders\/preview"/);
assert.match(structuredForm, /const payload = \{[\s\S]+\.\.\.form/);
assert.match(structuredForm, /items: form\.wo_type === "Daily Wage" \? lines\.map/);
assert.match(structuredForm, /Description of item/);
assert.match(structuredForm, /data-testid="daily-wage-items"/);
assert.match(structuredForm, /\/work-orders\/new\/structured\/preview/);
assert.match(structuredForm, /<Link href="\/forms\/work-orders"[^>]*>Back to Work Order Forms<\/Link>/);
assert.doesNotMatch(structuredForm, /<Link href="\/work-orders"[^>]*>Back to Work Orders<\/Link>/);
const detailPage = fs.readFileSync("app/work-orders/[id]/page.tsx", "utf8");
assert.match(detailPage, /useSearchParams/);
assert.match(detailPage, /searchParams\.get\("from"\) === "forms-work-orders" \? "\/forms\/work-orders" : "\/work-orders"/);
assert.match(detailPage, /<Link href=\{backHref\}[^>]*>[\s\S]*Back to Work Orders/);
assert.match(previewRoute, /requirePermission\(request, "work_orders", "add"\)/);
assert.match(createRoute, /WORK_ORDER_TYPES/);

console.log("Work Order Pilot Forms dashboard contract: PASS");
