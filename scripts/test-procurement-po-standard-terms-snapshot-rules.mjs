import assert from "node:assert/strict";
import fs from "node:fs";

const terms = fs.readFileSync("lib/procurement/standardTerms.ts", "utf8");
const updateRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const createRoute = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const pdf = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8") + "\n" + fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const createPage = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(terms, /buildPurchaseOrderStandardTermsSnapshot|template_id/);
assert.match(terms, /clauses/);
assert.match(terms, /JSON\.stringify/);
assert.match(createRoute, /standard_terms_template_id/);
assert.match(createRoute, /standard_terms_sections/);
assert.match(updateRoute, /buildPurchaseOrderStandardTermsSnapshot/);
assert.match(updateRoute, /status === "draft" \|\| result\.row\.status === "sent_back"/);
assert.match(updateRoute, /company_po_terms_templates/);
assert.match(updateRoute, /standardTerms/);
assert.match(pdf, /parsePurchaseOrderStandardTerms/);
assert.match(pdf, /function numberedTerms/);
assert.match(pdf, /withoutClauseNumber/);
assert.match(pdf, /numberedTerms\(row\.standard_terms_snapshot\)/);
assert.match(createPage, /const selectedTerms = companyTerms\.find\(\(row: any\) => row\.id === termsTemplateId\) \|\| null/);
assert.match(createPage, /companyTerms\.some\(\(row: any\) => row\.id === current\)/);
assert.doesNotMatch(createPage, /selectedTerms = companyTerms\.find\([\s\S]*\) \|\| companyTerms\.sort/);
assert.match(createPage, /setTermsTemplateId\(event\.target\.value\)/);
assert.doesNotMatch(updateRoute, /approved.*standard_terms_snapshot.*update/i);
console.log("Purchase Order structured terms snapshot rules passed.");
