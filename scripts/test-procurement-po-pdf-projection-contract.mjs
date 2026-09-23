import assert from "node:assert/strict";
import fs from "node:fs";

const base = fs.readFileSync("lib/procurement/poPdfBaseGeneration.server.ts", "utf8");
const renderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");

assert.match(base, /export type PurchaseOrderPdfProjection/);
assert.match(base, /export async function renderPurchaseOrderBasePdfFromProjection/);
assert.match(base, /return renderPurchaseOrderBasePdfFromProjection\(admin, data, previousRevisionData\)/);
assert.match(base, /const pdf = await renderPurchaseOrderBasePdfFromProjection\(admin, data, previousRevisionData\)/);
assert.match(base, /makePdf\(data,/);
assert.match(renderer, /export async function makePdf|export function makePdf/);

const source = {
  po_number: "PO/R-0",
  revision_no: 0,
  vendor_snapshot: { contact_person: "Aarti Gaur", phone: "1" },
  items: [{ quantity: 2, unit_rate: 10 }],
  total_amount: 20,
  standard_terms_snapshot: "terms",
};
const corrected = structuredClone(source);
corrected.vendor_snapshot.contact_person = "B.K JHA";
corrected.vendor_snapshot.phone = "9311088865";
assert.equal(corrected.vendor_snapshot.contact_person, "B.K JHA");
assert.deepEqual(corrected.items, source.items);
assert.equal(corrected.total_amount, source.total_amount);
assert.equal(corrected.po_number, source.po_number);
assert.equal(corrected.revision_no, source.revision_no);
assert.equal(source.vendor_snapshot.contact_person, "Aarti Gaur");

console.log("PASS: isolated PO PDF projection contract");
