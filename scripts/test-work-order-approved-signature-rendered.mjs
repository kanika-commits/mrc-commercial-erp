import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

const bytes = fs.readFileSync("tmp/work-order-approval-layout-fixture.pdf");
const pdf = await PDFDocument.load(bytes);
const raw = pdf.getPages().flatMap((page) => page.node.Contents().asArray().map((ref) => {
  const stream = pdf.context.lookup(ref);
  return inflateSync(Buffer.from(stream.getContents())).toString("latin1");
})).join("\n");
const text = raw.replace(/<([0-9A-Fa-f]+)> Tj/g, (_, hex) => Buffer.from(hex, "hex").toString("utf8"));

for (const value of ["Approved By", "For: Sanitized Company", "Signature:", "Name: Ada Approver", "Designation: Approver Designation", "Vendor Acceptance"]) {
  assert.match(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing approved PDF text: ${value}`);
}
const approvalBlock = text.slice(text.lastIndexOf("Approved By"));
assert.ok(approvalBlock.indexOf("Approved By") < approvalBlock.indexOf("For: Sanitized Company"));
assert.ok(approvalBlock.indexOf("For: Sanitized Company") < approvalBlock.indexOf("Signature:"));
assert.ok(approvalBlock.indexOf("Signature:") < approvalBlock.indexOf("Name: Ada Approver"));
assert.ok(approvalBlock.indexOf("Name: Ada Approver") < approvalBlock.indexOf("Designation: Approver Designation"));
assert.doesNotMatch(approvalBlock, /Approved At/);
assert.doesNotMatch(text, /DRAFT/);
assert.match(raw, /\/Image-[^ ]+ Do/);

console.log(`Approved signature PDF regression passed (${pdf.getPageCount()} page(s), genuine image XObject present)`);
