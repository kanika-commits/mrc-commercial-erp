import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import ts from "typescript";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "po-layout-"));
const require = createRequire(import.meta.url);
const pdfLib = require.resolve("pdf-lib");
const sources = {
  renderer: "lib/procurement/poPdfRenderer.server.ts",
  terms: "lib/procurement/standardTerms.ts",
  comparison: "lib/procurement/poRevisionComparison.ts",
  revisionRenderer: "lib/procurement/poRevisionPdfRenderer.ts",
};
const output = Object.fromEntries(Object.entries(sources).map(([key]) => [key, path.join(temp, `${key}.mjs`)]));
for (const [key, file] of Object.entries(sources)) {
  let source = fs.readFileSync(path.join(root, file), "utf8");
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  source = source.replaceAll('"@/lib/procurement/standardTerms"', JSON.stringify(output.terms));
  source = source.replaceAll('"@/lib/procurement/poRevisionComparison"', JSON.stringify(output.comparison));
  source = source.replaceAll('"@/lib/procurement/poRevisionPdfRenderer"', JSON.stringify(output.revisionRenderer));
  source = source.replaceAll('"pdf-lib"', JSON.stringify(pdfLib));
  fs.writeFileSync(output[key], source);
}

const { makePdf } = await import(output.renderer);
const renderer = fs.readFileSync(path.join(root, sources.renderer), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/procurement/purchase-orders/[id]/pdf/route.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/purchase/purchase-orders/[id]/page.tsx"), "utf8");
assert.match(route, /const finalPdf = await numberPackage\(protectedPdf, poPackage\.pageCount, poPackage\.footerRenderedHeight\)/);
assert.match(route, /const label = `\$\{index \+ 1\} of \$\{pages\.length\}`/);
assert.match(page, /max-w-\[1440px\].*px-4.*lg:px-8/);
assert.match(renderer, /amountX \+ widths\[amountIndex\] - CELL_PAD_X - valueWidth/);

const fixture = {
  id: "sanitized-po-layout",
  po_number: "SAN/PO/0001",
  revision_no: 0,
  status: "approved",
  po_date: "2026-11-24",
  vendor_name_snapshot: "Sanitized Vendor",
  vendor_snapshot: { vendor_name: "Sanitized Vendor", address: "1 Fixture Road", contact_name: "Fixture Contact", phone: "9000000000", email: "vendor@example.test", gstin: "07AAAAA0000A1Z5" },
  company: { company_name: "Sanitized Company" },
  site: { site_name: "Sanitized Site" },
  delivery_snapshot: { company_name: "Sanitized Company", address: "2 Fixture Delivery Road" },
  commercial_snapshot: {
    additional_charges: [{ name: "SERVICE CHARGE FOR EXTENDED SITE SUPERVISION AND COMMISSIONING SUPPORT ACROSS MULTIPLE FIXTURE LOCATIONS", amount: 5251000 }],
    key_terms: [{ id: "payment", label: "Payment", value: "30 days" }],
  },
  standard_terms_snapshot: JSON.stringify({ template_id: "fixture", clauses: Array.from({ length: 30 }, (_, index) => ({ heading: `Fixture clause ${index + 1}`, clause_body: `This sanitized term is intentionally long enough to verify that pagination remains clean for clause ${index + 1}.`, sort_order: index })) }),
  items: [{ item_name_snapshot: "Fixture item", specification_snapshot: "Fixture specification", make_snapshot: "Fixture make", quantity: 1, uom_snapshot: "Nos", unit_rate: 100000, gst_rate: 18, gst_amount: 18000, total_amount: 118000 }],
  total_basic_amount: 100000,
  total_gst_amount: 18000,
  total_freight_amount: 0,
};

const footer = { name: "fixtureFooter", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"), width: 1414, height: 154, format: "png" };
const result = await makePdf(fixture, { employee_name: "Fixture Creator", email: "creator@example.test" }, { employee_name: "Fixture Approver", designation: "Fixture Approver", signatureBlock: "Approved By", signatureAsset: null }, { letterhead: { header: null, footer, fullPage: false }, deliveryCompany: "Sanitized Company" });
assert.ok(Buffer.isBuffer(result.pdf) && result.pdf.length > 0);
assert.ok(result.pageCount >= 3, `expected pagination for sanitized fixture, got ${result.pageCount} pages`);

const streams = [];
for (const match of result.pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  const raw = Buffer.from(match[1], "latin1");
  try { streams.push(inflateSync(raw).toString("latin1")); } catch { streams.push(match[1]); }
}
const text = streams.join("\n");
const outputPdf = path.join(os.tmpdir(), "po-layout-sanitized.pdf");
fs.writeFileSync(outputPdf, result.pdf);
for (const expected of ["SERVICE CHARGE", "FOR EXTENDED SITE", "COMMISSIONING", "SUPPORT ACROSS", "52,51,000.00", "SAN/PO/0001", "Fixture clause 30"]) assert.ok(text.includes(expected), `sanitized PDF missing ${expected}`);
console.log(`PO sanitized layout fixture: PASS (pages=${result.pageCount}, bytes=${result.pdf.length}, output=${outputPdf})`);
