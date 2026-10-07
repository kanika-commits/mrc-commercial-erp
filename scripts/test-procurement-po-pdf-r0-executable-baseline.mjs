import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import ts from "typescript";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "po-pdf-r0-"));
const require = createRequire(import.meta.url);
const pdfLib = require.resolve("pdf-lib");

const sources = {
  renderer: "lib/procurement/poPdfRenderer.server.ts",
  terms: "lib/procurement/standardTerms.ts",
  comparison: "lib/procurement/poRevisionComparison.ts",
  revisionRenderer: "lib/procurement/poRevisionPdfRenderer.ts",
};
const output = Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, path.join(temp, `${key}.mjs`)]));
for (const [key, file] of Object.entries(sources)) {
  let source = fs.readFileSync(path.join(root, file), "utf8");
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  source = source.replaceAll('"@/lib/procurement/standardTerms"', JSON.stringify(output.terms));
  source = source.replaceAll('"@/lib/procurement/poRevisionComparison"', JSON.stringify(output.comparison));
  source = source.replaceAll('"@/lib/procurement/poRevisionPdfRenderer"', JSON.stringify(output.revisionRenderer));
  source = source.replaceAll('"pdf-lib"', JSON.stringify(pdfLib));
  source = source.replaceAll('"./poRevisionComparison"', JSON.stringify(output.comparison));
  source = source.replaceAll('"./standardTerms"', JSON.stringify(output.terms));
  source = source.replaceAll('"./poRevisionComparison"', JSON.stringify(output.comparison));
  fs.writeFileSync(output[key], source);
}
const { makePdf } = await import(output.renderer);
const { buildPurchaseOrderRevisionComparison } = await import(output.comparison);
const { buildPurchaseOrderRevisionPdfRenderModel } = await import(output.revisionRenderer);
const pdfRoute = fs.readFileSync(path.join(root, "app/api/procurement/purchase-orders/[id]/pdf/route.ts"), "utf8");
assert.match(pdfRoute, /const revisionPdfRequested = Number\(data\.revision_no \\|\\| 0\) > 0 && Boolean\(data\.previous_revision_id\)/);
assert.match(pdfRoute, /\(comparisonRequested \|\| revisionPdfRequested\) && revisionPdfRequested/);

const image = { name: "fixture", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"), width: 1000, height: 100, format: "png" };
const standardTerms = JSON.stringify({ template_id: "fixture-standard", template_name: "Fixture Standard", clauses: Array.from({ length: 9 }, (_, i) => ({ heading: `Clause ${i + 1}`, clause_body: `Standard term body ${i + 1}`, sort_order: i })) });
const row = {
  id: "fixture-po-id", po_number: "MRC/SEP/2026/0006/R-0", revision_no: 0, status: "approved", po_date: "2026-09-11",
  vendor_name_snapshot: "Ardex India Pvt. Ltd.", vendor_snapshot: { name: "Ardex India Pvt. Ltd.", address: "Jaipur Vendor Road", contact_name: "Vendor Contact", mobile: "9876543210", email: "vendor@example.test", gstin: "08ABCDE1234F1Z5" },
  company: { company_name: "MRC Infracon Limited" }, site: { site_name: "MRC Delhi Site" }, delivery_snapshot: { company_name: "MRC Infracon Limited", address: "Delhi Delivery Address" },
  commercial_snapshot: { key_terms: [{ id: "price", label: "Price Validity", value: "30 days" }, { id: "freight", label: "Freight", value: "FOR at site." }, { id: "delivery", label: "Delivery Timeline", value: "15 days" }, { id: "payment", label: "Payment Terms", value: "30 days" }] },
  standard_terms_snapshot: standardTerms,
  items: [
    { item_name_snapshot: "Epoxy Dark Brown", specification_snapshot: "Epoxy coating", make_snapshot: "Ardex", quantity: 40, uom_snapshot: "Kg", unit_rate: 2850, gst_rate: 18, gst_amount: 20520, total_amount: 134520 },
    { item_name_snapshot: "Epoxy Dark Grey", specification_snapshot: "Epoxy coating", make_snapshot: "Ardex", quantity: 20, uom_snapshot: "Kg", unit_rate: 2850, gst_rate: 18, gst_amount: 10260, total_amount: 67260 },
  ],
  total_basic_amount: 201780, total_freight_amount: 0, total_gst_amount: 30780,
  created_by_name: "Test Creator", created_by_email: "creator@example.test", approved_by_name: "Test Approver", approved_by_company_name: "MRC Infracon Limited", approved_by_designation_name: "Director",
};
const result = await makePdf(row, { employee_name: "Test Creator", email: "creator@example.test", designation: "Procurement Manager" }, { employee_name: "Test Approver", company: "MRC Infracon Limited", designation: "Director", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" });
assert.ok(Buffer.isBuffer(result.pdf) && result.pdf.length > 0);
assert.equal(result.pageCount, 2, "R-0 page count baseline changed");
assert.ok(result.footerRenderedHeight > 0);
const pdfText = [];
for (const match of result.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { pdfText.push(inflateSync(bytes).toString("latin1")); } catch { pdfText.push(match[1]); }
}
const extractedText = pdfText.join("\n");
for (const value of ["MRC/SEP/2026/0006/R-0", "Ardex India Pvt. Ltd.", "Epoxy Dark Brown", "Epoxy Dark Grey", "Rs. 2,850.00", "Rs. 1,14,000.00", "Rs. 57,000.00", "40", "20", "18%", "Price Validity", "Freight", "Delivery Timeline", "Payment Terms", ...Array.from({ length: 9 }, (_, i) => `Clause ${i + 1}`), "Test Approver", "Approved By"]) assert.ok(extractedText.includes(value), `generated PDF missing ${value}`);
assert.ok(extractedText.includes("1") && extractedText.includes("9"), "standard terms numbering baseline changed");
assert.ok(!extractedText.includes("1. 1."));
console.log(`PO executable R-0 baseline: PASS (bytes=${result.pdf.length}, pages=${result.pageCount}, footer=${result.footerRenderedHeight})`);

const brownKey = "cdafeb2d-56ee-493a-8147-a6bf5a67c4d0";
const greyKey = "1b4de049-e2f3-4e58-a6c3-ed0893f54e94";
const blueKey = "6c4f2a0e-8e22-4e61-a1e4-4d6c2bcb7f42";
const clauseIds = ["term-01", "term-02", "term-03", "term-04", "term-05", "term-06", "term-07", "term-08", "term-09"];
const identifiedTerms = JSON.stringify({ template_id: "fixture-standard", template_name: "Fixture Standard", clauses: clauseIds.map((id, i) => ({ id, heading: `Clause ${i + 1}`, clause_body: `Standard term body ${i + 1}`, sort_order: i })) });
const previous = { ...row, id: "fixture-po-r0", po_number: "MRC/SEP/2026/0006/R-0", revision_no: 0, previous_revision_id: null, standard_terms_snapshot: identifiedTerms, items: [
  { ...row.items[0], revision_line_key: brownKey, uom_snapshot: "Bag", unit_rate: 2850 },
  { ...row.items[1], revision_line_key: greyKey, uom_snapshot: "Bag" },
], commercial_snapshot: { key_terms: [
  { id: "price", label: "Price Validity", value: "Freeze for the order." },
  { id: "freight", label: "Freight", value: "FOR at site." },
  { id: "delivery", label: "Delivery Timeline", value: "Immediate delivery of the materials required at the site." },
  { id: "payment", label: "Payment Terms", value: "30 days credit from the date of invoice." },
], additional_charges: [] } };
const current = { ...previous, id: "fixture-po-r1", po_number: "MRC/SEP/2026/0006/R-1", revision_no: 1, previous_revision_id: previous.id, total_basic_amount: 205000, total_gst_amount: 31000, total_amount: 236000, standard_terms_snapshot: JSON.stringify({ template_id: "fixture-standard", clauses: [...clauseIds.map((id, i) => ({ id, heading: `Clause ${i + 1}`, clause_body: i === 0 ? "Changed standard term body" : `Standard term body ${i + 1}`, sort_order: i })), { id: "term-10", heading: "New clause", clause_body: "New standard term", sort_order: 9 }] }), items: [
  { ...previous.items[0], item_name_snapshot: "Epoxy Dark Brown Revised", specification_snapshot: "Changed epoxy coating", quantity: 45, unit_rate: 1234 },
  { ...previous.items[0], revision_line_key: blueKey, item_name_snapshot: "Epoxy Bright Blue", specification_snapshot: "New blue coating", quantity: 3, unit_rate: 500 },
], commercial_snapshot: { ...previous.commercial_snapshot, key_terms: previous.commercial_snapshot.key_terms.map((term) => term.id === "freight" ? { ...term, value: "This is test change too." } : term), additional_charges: [{ id: "test-charge", name: "Test Charge", amount: 1234 }] } };
const comparison = buildPurchaseOrderRevisionComparison(previous, current);
const brownComparison = comparison.items.find((item) => item.revision_line_key === brownKey);
const greyComparison = comparison.items.find((item) => item.revision_line_key === greyKey);
assert.equal(brownComparison.fields.unit_rate.state, "changed");
assert.equal(brownComparison.fields.unit_rate.before, 2850);
assert.equal(brownComparison.fields.unit_rate.after, 1234);
assert.equal(brownComparison.fields.quantity.state, "changed");
assert.equal(brownComparison.fields.basic_amount.state, "changed");
assert.equal(brownComparison.fields.gst_rate.state, "unchanged");
assert.equal(brownComparison.fields.make_snapshot.state, "unchanged");
assert.equal(greyComparison.state, "removed");
const blueComparison = comparison.items.find((item) => item.revision_line_key === blueKey);
assert.equal(blueComparison.state, "added");
assert.ok(comparison.items.find((item) => item.revision_line_key === greyKey).state === "removed");
assert.equal(comparison.keyTerms.find((term) => term.identity === "freight").state, "changed");
const testChargeComparison = comparison.additionalCharges.find((charge) => charge.identity === "test-charge");
assert.equal(testChargeComparison.state, "added");
assert.equal(testChargeComparison.before, undefined);
assert.equal(testChargeComparison.after.amount, 1234);
assert.equal(comparison.standardTerms.length, 10);
assert.equal(comparison.standardTerms.filter((term) => term.state === "unchanged").length, 8);
const presentation = buildPurchaseOrderRevisionPdfRenderModel(current, comparison);
assert.deepEqual(presentation.items.find((item) => item.revision_line_key === brownKey).fields.unit_rate.runs, [{ text: "Rs. 2,850.00", color: "normal", strike: true }, { text: "Rs. 1,234.00", color: "red", strike: false }]);
assert.equal(presentation.items.find((item) => item.revision_line_key === brownKey).fields.quantity.runs[0].color, "normal");
assert.equal(presentation.keyTerms.find((term) => term.identity === "freight").value.runs[0].strike, true);
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs.length, 1);
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs[0].color, "red");
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs[0].strike, false);
assert.ok(presentation.items.find((item) => item.revision_line_key === brownKey).fields.specification_snapshot.runs.some((run) => run.color === "red"));
assert.ok(presentation.items.find((item) => item.revision_line_key === brownKey).fields.quantity.runs.some((run) => run.color === "red"));
assert.ok(presentation.items.find((item) => item.revision_line_key === brownKey).fields.basic_amount.runs.some((run) => run.color === "red"));
for (const field of ["item_name_snapshot", "specification_snapshot", "quantity", "unit_rate", "basic_amount", "gst_rate", "gst_amount", "total_amount"]) {
  assert.ok(presentation.items.find((item) => item.revision_line_key === blueKey).fields[field].runs.every((run) => run.color === "red"), `added ${field} was not entirely red`);
}
for (const field of ["item_name_snapshot", "specification_snapshot", "quantity", "unit_rate", "basic_amount", "gst_rate", "gst_amount", "total_amount"]) {
  assert.ok(presentation.items.find((item) => item.revision_line_key === greyKey).fields[field].runs.every((run) => run.color === "red" && run.strike), `removed ${field} was not red and struck through`);
}
assert.ok(presentation.summary.total.runs.some((run) => run.color === "red"));
assert.ok(presentation.standardTerms.flatMap((term) => [...term.heading.runs, ...term.body.runs]).some((run) => run.color === "red"));
const revisionResult = await makePdf(current, { employee_name: "Test Creator", email: "creator@example.test", designation: "Procurement Manager" }, { employee_name: "Test Approver", company: "MRC Infracon Limited", designation: "Director", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" }, presentation);
assert.ok(Buffer.isBuffer(revisionResult.pdf) && revisionResult.pdf.length > 0);
assert.ok(revisionResult.pageCount > 0);
const revisionStreams = [];
for (const match of revisionResult.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { revisionStreams.push(inflateSync(bytes).toString("latin1")); } catch { revisionStreams.push(match[1]); }
}
const revisionText = revisionStreams.join("\n");
for (const value of ["MRC/SEP/2026/0006/R-1", "Epoxy Dark Brown", "Epoxy Dark Brown Revised", "Changed epoxy coating", "Epoxy Bright Blue", "New blue coating", "Epoxy Dark Grey", "Rs. 2,850.00", "Rs. 1,234.00", "Rs. 55,530.00", "Rs. 1,234.00", "45", "3", "18%", "FOR at site.", "This is test change too.", "Test Charge", "Changed standard term body", "New standard term", ...Array.from({ length: 9 }, (_, i) => `Clause ${i + 1}`)]) assert.ok(revisionText.includes(value), `generated R-1 PDF missing ${value}`);
for (const value of ["MRC/SEP/2026/0006/R-1", "Epoxy Dark Brown", "Epoxy Dark Brown Revised", "Changed epoxy coating", "Epoxy Bright Blue", "New blue coating", "Epoxy Dark Grey", "Rs. 2,850.00", "Rs. 1,234.00", "Rs. 55,530.00", "45", "3", "18%", "FOR at site.", "This is test change too.", "Test Charge", "Changed standard term body", "New standard term", ...Array.from({ length: 9 }, (_, i) => `Clause ${i + 1}`)]) assert.ok(revisionText.includes(value), `generated R-1 PDF missing ${value}`);
assert.ok(revisionText.includes("0 0 0 RG"), "generated R-1 PDF is missing a black strike operator");
assert.ok(revisionText.includes("0.72 0.08 0.08 rg"), "generated R-1 PDF is missing red changed-value styling");
const testChargeText = revisionText.slice(Math.max(0, revisionText.indexOf("Test Charge") - 120), revisionText.indexOf("Test Charge") + 180);
assert.ok(!testChargeText.includes("Rs. 0.00"), "Test Charge must not render a synthetic old zero amount");
console.log(`PO executable R-1 PDF: PASS (bytes=${revisionResult.pdf.length}, pages=${revisionResult.pageCount}, footer=${revisionResult.footerRenderedHeight})`);

const legacyPrevious = { ...previous, id: "live-shaped-r0", po_number: "GLC/SEP/2026/0009/R-0", revision_no: 0, items: [{ ...previous.items[0], revision_line_key: null, item_name_snapshot: "SS 316 Chair Type Clamp 50 – 65 mm", item_code_snapshot: "MAT001002", specification_snapshot: "250 GMS" }] };
const legacyCurrent = { ...legacyPrevious, id: "live-shaped-r1", po_number: "GLC/SEP/2026/0009/R-1", revision_no: 1, previous_revision_id: legacyPrevious.id, items: [{ ...legacyPrevious.items[0], revision_line_key: null, item_name_snapshot: "Chair Clamp 50X65MM", item_code_snapshot: "MAT000032", specification_snapshot: "230 GRM" }] };
const legacyPresentation = buildPurchaseOrderRevisionPdfRenderModel(legacyCurrent, buildPurchaseOrderRevisionComparison(legacyPrevious, legacyCurrent));
const legacyResult = await makePdf(legacyCurrent, { employee_name: "Test Creator", email: "creator@example.test", designation: "Procurement Manager" }, { employee_name: "Test Approver", company: "MRC Infracon Limited", designation: "Director", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" }, legacyPresentation);
const legacyStreams = [];
for (const match of legacyResult.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { legacyStreams.push(inflateSync(bytes).toString("latin1")); } catch { legacyStreams.push(match[1]); }
}
const legacyText = legacyStreams.join("\n");
for (const value of ["SS 316 Chair Type Clamp 50", "Chair Clamp 50X65MM", "250 GMS", "230 GRM"]) assert.ok(legacyText.includes(value), `legacy null-key R-1 PDF missing ${value}`);
assert.ok(legacyText.includes("0.72 0.08 0.08 rg"), "legacy null-key R-1 PDF missing red styling operator");
assert.ok(legacyText.includes("0.72 0.08 0.08 rg"), "legacy null-key R-1 PDF missing red strike styling operator");
console.log(`PO executable legacy NULL-key R-1 PDF: PASS (bytes=${legacyResult.pdf.length}, pages=${legacyResult.pageCount})`);

const fallbackPrevious = { ...previous, id: "fallback-r0", po_number: "PI/SEP/2026/0007/R-0", revision_no: 0, items: [
  { ...previous.items[0], revision_line_key: null, source_requisition_line_key: null, item_code_snapshot: "PI-0007-A", item_name_snapshot: "Original description", specification_snapshot: "Original specification" },
  { ...previous.items[1], revision_line_key: null, source_requisition_line_key: null, item_code_snapshot: "PI-0007-B", item_name_snapshot: "Unchanged description" },
] };
const fallbackCurrent = { ...fallbackPrevious, id: "fallback-r1", po_number: "PI/SEP/2026/0007/R-1", revision_no: 1, previous_revision_id: fallbackPrevious.id, items: [
  { ...fallbackPrevious.items[0], id: "new-item-a", item_name_snapshot: "Edited description", specification_snapshot: "Edited specification", quantity: 41, unit_rate: 2900 },
  { ...fallbackPrevious.items[1], id: "new-item-b" },
] };
const fallbackComparison = buildPurchaseOrderRevisionComparison(fallbackPrevious, fallbackCurrent);
assert.equal(fallbackComparison.items[0].fields.item_name_snapshot.state, "changed");
assert.equal(fallbackComparison.items[0].fields.specification_snapshot.state, "changed");
const fallbackPresentation = buildPurchaseOrderRevisionPdfRenderModel(fallbackCurrent, fallbackComparison);
const fallbackResult = await makePdf(fallbackCurrent, { employee_name: "Test Creator" }, { employee_name: "Test Approver", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" }, fallbackPresentation);
const fallbackText = [];
for (const match of fallbackResult.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { fallbackText.push(inflateSync(bytes).toString("latin1")); } catch { fallbackText.push(match[1]); }
}
const fallbackPdfText = fallbackText.join("\n");
assert.ok(fallbackPdfText.includes("Edited description") && fallbackPdfText.includes("Edited specification"));
assert.ok(fallbackPdfText.includes("0.72 0.08 0.08 rg"), "normal fallback-key R-1 PDF missing red changed-description styling");
console.log(`PO executable fallback-key R-1 PDF: PASS (bytes=${fallbackResult.pdf.length}, pages=${fallbackResult.pageCount})`);

const longTerms = JSON.stringify({ template_id: "fixture-long", clauses: Array.from({ length: 40 }, (_, i) => ({ id: `long-${i + 1}`, heading: `Long clause heading ${i + 1}`, clause_body: `This is a deliberately long standard term body for clause ${i + 1} that must wrap across measured lines without colliding with the next clause or overflowing the page boundary.`, sort_order: i })) });
const longRow = { ...row, standard_terms_snapshot: longTerms };
const longResult = await makePdf(longRow, { employee_name: "Test Creator", email: "creator@example.test", designation: "Procurement Manager" }, { employee_name: "Test Approver", company: "MRC Infracon Limited", designation: "Director", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" });
assert.ok(longResult.pageCount > result.pageCount, "long Standard Terms fixture did not cross a page boundary");
const longStreams = [];
for (const match of longResult.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { longStreams.push(inflateSync(bytes).toString("latin1")); } catch { longStreams.push(match[1]); }
}
const longText = longStreams.join("\n");
for (const value of ["Long clause heading 1", "Long clause heading 40", "clause 1", "clause 40"]) assert.ok(longText.includes(value), `long Standard Terms PDF missing ${value}`);
assert.ok(!longText.includes("1. 1."), "long Standard Terms PDF double-numbered a clause");
console.log(`PO executable long Standard Terms layout: PASS (pages=${longResult.pageCount})`);
