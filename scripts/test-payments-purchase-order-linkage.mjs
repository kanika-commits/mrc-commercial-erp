import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "payment-po-linkage-"));

function compile(sourcePath, outputPath, replacements = []) {
  let source = fs.readFileSync(path.join(root, sourcePath), "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  fs.writeFileSync(path.join(temp, outputPath), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
}

compile("lib/procurement/poRevisionEffective.ts", "poRevisionEffective.mjs");
compile("lib/payments/purchaseOrderPayment.ts", "purchaseOrderPayment.mjs", [
  ['"@/lib/procurement/poRevisionEffective"', '"./poRevisionEffective.mjs"'],
]);
const {
  selectEffectivePayablePurchaseOrders,
  validateSiteQubePaymentSelection,
  validateManualPurchaseOrderSelection,
  paymentPurchaseOrderLabel,
} = await import(path.join(temp, "purchaseOrderPayment.mjs"));

const common = {
  organization_id: "org-1",
  company_id: "company-1",
  site_id: "site-1",
  vendor_id: "vendor-1",
  status: "approved",
};
const poR0 = { ...common, id: "po-r0", po_number: "MRC/SEP/2026/0013", revision_family_id: "family-1", revision_no: 0, superseded_by_revision_id: "po-r1", created_at: "2026-09-01T00:00:00Z" };
const poR1 = { ...common, id: "po-r1", po_number: "MRC/SEP/2026/0013-R1", revision_family_id: "family-1", revision_no: 1, status: "issued", created_at: "2026-09-02T00:00:00Z" };
const draftR2 = { ...common, id: "po-r2", po_number: "MRC/SEP/2026/0013-R2", revision_family_id: "family-1", revision_no: 2, status: "draft", created_at: "2026-09-03T00:00:00Z" };
const independent = { ...common, id: "po-other", po_number: "MRC/SEP/2026/0014", revision_family_id: null, revision_no: 0 };
const effective = selectEffectivePayablePurchaseOrders([poR0, poR1, draftR2, independent]);
assert.deepEqual(effective.map((row) => row.id), ["po-r1", "po-other"], "one selectable current approved/issued row per PO family; no superseded or draft duplicates");
assert.equal(paymentPurchaseOrderLabel({ po_number: poR1.po_number, vendor_name: "MRC Vendor", site_name: "CRPF HQ" }), `${poR1.po_number} — MRC Vendor — CRPF HQ`);

const submitted = {
  purchase_order_id: "po-r1",
  company_id: "company-1",
  site_id: "site-1",
  vendor_id: "vendor-1",
  reference_number: poR1.po_number,
};
assert.equal(validateSiteQubePaymentSelection(submitted, poR1), null, "canonical current SiteQube PO selection is accepted");
for (const [field, value] of [["company_id", "company-2"], ["site_id", "site-2"], ["vendor_id", "vendor-2"], ["reference_number", "forged"]]) {
  assert.ok(validateSiteQubePaymentSelection({ ...submitted, [field]: value }, poR1), `${field} tampering is rejected`);
}
assert.ok(validateSiteQubePaymentSelection({ ...submitted, purchase_order_id: "po-r0" }, poR1), "previous revision selection is rejected");
assert.ok(validateSiteQubePaymentSelection(submitted, { ...poR1, status: "draft" }), "non-payable status is rejected");

const manual = { company_id: "company-1", site_id: "site-1", vendor_id: "vendor-1", reference_number: "OLD/PO/458", purchase_order_id: "" };
assert.equal(validateManualPurchaseOrderSelection(manual), null, "complete Manual / Old PO is accepted");
for (const [field, value] of [["company_id", ""], ["site_id", ""], ["vendor_id", ""], ["reference_number", " "]]) {
  assert.ok(validateManualPurchaseOrderSelection({ ...manual, [field]: value }), `${field} is required for Manual / Old PO`);
}
assert.ok(validateManualPurchaseOrderSelection({ ...manual, purchase_order_id: "po-r1" }), "Manual / Old PO cannot persist a SiteQube PO id");

const entry = fs.readFileSync(path.join(root, "app/payments/new/page.tsx"), "utf8");
const lookups = fs.readFileSync(path.join(root, "app/api/payments/purchase-order-lookups/route.ts"), "utf8");
const createApi = fs.readFileSync(path.join(root, "app/api/payments/route.ts"), "utf8");
const registerApi = fs.readFileSync(path.join(root, "app/api/payments/register/route.ts"), "utf8");
const registerPage = fs.readFileSync(path.join(root, "app/payments/page.tsx"), "utf8");
const detailPage = fs.readFileSync(path.join(root, "app/payments/[id]/page.tsx"), "utf8");
const createLookups = fs.readFileSync(path.join(root, "app/api/commercial/create-lookups/route.ts"), "utf8");

assert.match(entry, /fetchWithToken\("\/api\/payments\/purchase-order-lookups"\)/, "PO/site/company lookups load from the scoped endpoint");
assert.match(entry, /handlePurchaseOrderSelect[\s\S]*purchase_order_id: purchaseOrder\.id[\s\S]*site_id: purchaseOrder\.site_id[\s\S]*vendor_id: purchaseOrder\.vendor_id[\s\S]*reference_number: purchaseOrder\.po_number/);
assert.match(entry, /SiteQube PO[\s\S]*Manual \/ Old PO/);
assert.match(entry, /aria-label=\{`Site \/ Project row/);
assert.match(entry, /aria-label=\{`Manual PO Vendor row/);
assert.match(entry, /po_source[\s\S]*purchase_order_id[\s\S]*site_id/);
assert.match(entry, /Paste rejected: SiteQube PO[\s\S]*does not match an available current Purchase Order/);
assert.match(entry, /Paste rejected: Vendor \/ Party[\s\S]*does not match the selected SiteQube PO/);
assert.match(lookups, /\.in\("status", \["approved", "issued"\]\)[\s\S]*\.is\("superseded_by_revision_id", null\)/);
assert.match(lookups, /selectEffectivePayablePurchaseOrders/);
assert.match(lookups, /siteIds\.has\(po\.site_id\)/);
assert.doesNotMatch(lookups, /sites[^\n]*\.eq\("company_id"/i, "site lookup never uses company_id as site ownership");
assert.match(createApi, /admin\.rpc\([\s\S]*"procurement_purchase_order_effective_revision"/);
assert.match(createApi, /validateSiteQubePaymentSelection/);
assert.match(createApi, /validateManualPurchaseOrderSelection/);
assert.match(createApi, /assignments\.siteIds\.includes\(submittedSiteId\)/);
assert.match(createApi, /selectedSite\.organization_id !== organizationId/);
assert.match(createApi, /manualVendor\.organization_id !== organizationId/);
assert.match(createApi, /manualVendor\.status !== "active" \|\| manualVendor\.is_deleted/);
assert.match(createLookups, /\.eq\("status", "active"\)[\s\S]*\.or\("is_deleted\.is\.null,is_deleted\.eq\.false"\)[\s\S]*purchaseOrderVendors/);
assert.match(createApi, /purchase_order_id: persistedPurchaseOrderId/);
assert.match(createApi, /site_id: persistedSiteId/);
assert.match(createApi, /persistedPurchaseOrderId = null/);
assert.match(registerApi, /site_id,[\s\S]*purchase_order_id/);
assert.match(registerApi, /siteIds\.length\) clauses\.push\(`site_id\.in/);
assert.match(registerApi, /purchase_order_source:[\s\S]*SiteQube PO[\s\S]*Manual \/ Old PO/);
assert.match(registerPage, /payment\.reference[\s\S]*purchase_order_source[\s\S]*payment\.site_name/);
assert.match(detailPage, /PO Source[\s\S]*payment\.purchase_order_id[\s\S]*payment\.reference_number/);
assert.match(detailPage, /if \(paymentData\.site_id\)[\s\S]*\.from\("sites"\)[\s\S]*setSite\(siteData\)/);
assert.match(detailPage, /Info label="Site" value=\{site\?\.site_name/);
assert.match(createApi, /if \(paymentType === "Purchase Order"\)[\s\S]*persistedSiteId = effectivePo\.site_id/);
assert.match(createApi, /site_id: persistedSiteId,[\s\S]*purchase_order_id: persistedPurchaseOrderId/);
assert.match(entry, /if \(row\.payment_type === "Work Order" && !row\.work_order_id\)/, "existing Work Order required-field behavior remains");
assert.match(entry, /const transfer = total - tds/, "existing TDS/transfer calculation remains row-wise");
assert.match(entry, /for \(const \[index, row\] of filledRows\.entries\(\)\)/, "mixed payment rows continue to save independently");

console.log("Payment Purchase Order linkage behavior/contracts: PASS");
