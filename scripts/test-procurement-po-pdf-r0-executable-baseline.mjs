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
for (const value of ["MRC/SEP/2026/0006/R-0", "Ardex India Pvt. Ltd.", "Epoxy Dark Brown", "Epoxy Dark Grey", "Rs. 2,850.00", "40", "20", "18%", "Price Validity", "Freight", "Delivery Timeline", "Payment Terms", ...Array.from({ length: 9 }, (_, i) => `Clause ${i + 1}`), "Test Approver", "Approved By"]) assert.ok(extractedText.includes(value), `generated PDF missing ${value}`);
assert.ok(extractedText.includes("1") && extractedText.includes("9"), "standard terms numbering baseline changed");
assert.ok(!extractedText.includes("1. 1."));
console.log(`PO executable R-0 baseline: PASS (bytes=${result.pdf.length}, pages=${result.pageCount}, footer=${result.footerRenderedHeight})`);

const brownKey = "cdafeb2d-56ee-493a-8147-a6bf5a67c4d0";
const greyKey = "1b4de049-e2f3-4e58-a6c3-ed0893f54e94";
const clauseIds = ["term-01", "term-02", "term-03", "term-04", "term-05", "term-06", "term-07", "term-08", "term-09"];
const identifiedTerms = JSON.stringify({ template_id: "fixture-standard", template_name: "Fixture Standard", clauses: clauseIds.map((id, i) => ({ id, heading: `Clause ${i + 1}`, clause_body: `Standard term body ${i + 1}`, sort_order: i })) });
const previous = { ...row, id: "fixture-po-r0", po_number: "MRC/SEP/2026/0006/R-0", revision_no: 0, previous_revision_id: null, standard_terms_snapshot: identifiedTerms, items: [
  { ...row.items[0], revision_line_key: brownKey, item_code_snapshot: "MAT001002", specification_snapshot: "250 GMS", uom_snapshot: "Bag", unit_rate: 2850 },
  { ...row.items[1], revision_line_key: greyKey, uom_snapshot: "Bag" },
], commercial_snapshot: { key_terms: [
  { id: "price", label: "Price Validity", value: "Freeze for the order." },
  { id: "freight", label: "Freight", value: "FOR at site." },
  { id: "delivery", label: "Delivery Timeline", value: "Immediate delivery of the materials required at the site." },
  { id: "payment", label: "Payment Terms", value: "30 days credit from the date of invoice." },
], additional_charges: [] } };
const current = { ...previous, id: "fixture-po-r1", po_number: "MRC/SEP/2026/0006/R-1", revision_no: 1, previous_revision_id: previous.id, items: [
  { ...previous.items[0], item_code_snapshot: "MAT00032", specification_snapshot: "230 GRM", unit_rate: 1234 },
  previous.items[1],
], commercial_snapshot: { ...previous.commercial_snapshot, key_terms: previous.commercial_snapshot.key_terms.map((term) => term.id === "freight" ? { ...term, value: "This is test change too." } : term), additional_charges: [{ id: "test-charge", name: "Test Charge", amount: 1234 }] } };
const comparison = buildPurchaseOrderRevisionComparison(previous, current);
const brownComparison = comparison.items.find((item) => item.revision_line_key === brownKey);
const greyComparison = comparison.items.find((item) => item.revision_line_key === greyKey);
assert.equal(brownComparison.fields.unit_rate.state, "changed");
assert.equal(brownComparison.fields.unit_rate.before, 2850);
assert.equal(brownComparison.fields.unit_rate.after, 1234);
assert.equal(brownComparison.fields.item_code_snapshot.state, "changed");
assert.equal(brownComparison.fields.item_code_snapshot.before, "MAT001002");
assert.equal(brownComparison.fields.item_code_snapshot.after, "MAT00032");
assert.equal(brownComparison.fields.specification_snapshot.state, "changed");
assert.equal(brownComparison.fields.specification_snapshot.before, "250 GMS");
assert.equal(brownComparison.fields.specification_snapshot.after, "230 GRM");
assert.equal(brownComparison.fields.quantity.state, "unchanged");
assert.equal(brownComparison.fields.gst_rate.state, "unchanged");
assert.equal(brownComparison.fields.make_snapshot.state, "unchanged");
assert.equal(greyComparison.state, "unchanged");
assert.equal(comparison.keyTerms.find((term) => term.identity === "freight").state, "changed");
const testChargeComparison = comparison.additionalCharges.find((charge) => charge.identity === "test-charge");
assert.equal(testChargeComparison.state, "added");
assert.equal(testChargeComparison.before, undefined);
assert.equal(testChargeComparison.after.amount, 1234);
assert.equal(comparison.standardTerms.length, 9);
assert.equal(comparison.standardTerms.filter((term) => term.state === "unchanged").length, 9);
const presentation = buildPurchaseOrderRevisionPdfRenderModel(current, comparison);
assert.deepEqual(presentation.items.find((item) => item.revision_line_key === brownKey).fields.unit_rate.runs, [{ text: "2850", color: "normal", strike: true }, { text: "1234", color: "red", strike: false }]);
assert.equal(presentation.items.find((item) => item.revision_line_key === brownKey).fields.quantity.runs[0].color, "normal");
assert.equal(presentation.keyTerms.find((term) => term.identity === "freight").value.runs[0].strike, true);
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs.length, 1);
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs[0].color, "red");
assert.equal(presentation.additionalCharges.find((charge) => charge.identity === "test-charge").amount.runs[0].strike, false);
assert.equal(presentation.standardTerms.flatMap((term) => [...term.heading.runs, ...term.body.runs]).filter((run) => run.color === "red").length, 0);
const revisionResult = await makePdf(current, { employee_name: "Test Creator", email: "creator@example.test", designation: "Procurement Manager" }, { employee_name: "Test Approver", company: "MRC Infracon Limited", designation: "Director", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: image, footer: image, fullPage: false }, deliveryCompany: "MRC Infracon Limited" }, presentation);
assert.ok(Buffer.isBuffer(revisionResult.pdf) && revisionResult.pdf.length > 0);
assert.ok(revisionResult.pageCount > 0);
const revisionStreams = [];
for (const match of revisionResult.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const bytes = Buffer.from(match[1], "latin1");
  try { revisionStreams.push(inflateSync(bytes).toString("latin1")); } catch { revisionStreams.push(match[1]); }
}
const revisionText = revisionStreams.join("\n");
for (const value of ["MRC/SEP/2026/0006/R-1", "Epoxy Dark Brown", "Epoxy Dark Grey", "MAT001002", "MAT00032", "250 GMS", "230 GRM", "2850", "1234", "18%", "FOR at site.", "This is test change too.", "Test Charge", ...Array.from({ length: 9 }, (_, i) => `Clause ${i + 1}`)]) assert.ok(revisionText.includes(value), `generated R-1 PDF missing ${value}`);
assert.ok(revisionText.includes("0 0 0 RG"), "generated R-1 PDF is missing a black strike operator");
assert.ok(revisionText.includes("2850") && revisionText.includes("1234"), "generated R-1 PDF is missing changed rate values");
const testChargeText = revisionText.slice(Math.max(0, revisionText.indexOf("Test Charge") - 120), revisionText.indexOf("Test Charge") + 180);
assert.ok(!testChargeText.includes("Rs. 0.00"), "Test Charge must not render a synthetic old zero amount");
console.log(`PO executable R-1 PDF: PASS (bytes=${revisionResult.pdf.length}, pages=${revisionResult.pageCount}, footer=${revisionResult.footerRenderedHeight})`);

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
