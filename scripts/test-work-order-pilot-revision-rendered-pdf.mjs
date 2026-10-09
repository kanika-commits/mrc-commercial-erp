import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

const tmpDir = path.resolve("tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const rendererPath = path.join(tmpDir, `work-order-pdf-renderer-${process.pid}.ts`);
const revisionsPath = path.join(tmpDir, `work-order-pilot-revisions-${process.pid}.ts`);
const adapterPath = path.join(tmpDir, `work-order-pilot-revision-pdf-${process.pid}.ts`);
try {
  const rendererUrl = pathToFileURL(rendererPath).href;
  const revisionsUrl = pathToFileURL(revisionsPath).href;
  fs.writeFileSync(rendererPath, fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8").replace('import { adminClient } from "@/lib/serverProcurementAccess";', "const adminClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }) }) }), storage: { from: () => ({ download: async () => ({ data: null }) }) } });"));
  fs.writeFileSync(revisionsPath, fs.readFileSync("lib/workOrderPilotRevisions.server.ts", "utf8").replace('from "@/lib/workOrderPdfRenderer.server"', `from ${JSON.stringify(rendererUrl)}`));
  fs.writeFileSync(adapterPath, fs.readFileSync("lib/workOrderPilotRevisionPdf.server.ts", "utf8").replace('from "@/lib/workOrderPdfRenderer.server"', `from ${JSON.stringify(rendererUrl)}`).replace('from "@/lib/workOrderPilotRevisions.server"', `from ${JSON.stringify(revisionsUrl)}`));
  const { renderWorkOrderPdf } = await import(`${rendererUrl}?renderer=${Date.now()}`);
  const { renderPilotRevisionPdf } = await import(`${pathToFileURL(adapterPath).href}?fixture=${Date.now()}`);
  const baseItems = [
    { item_master_id: "same", item_header_snapshot: "Duplicate Item", description_snapshot: "First specification", make_snapshot: "Original mode", unit_snapshot: "kg", quantity: 1, unit_rate: 100, gst_rate: 18, total_amount: 118 },
    { item_master_id: "same", item_header_snapshot: "Duplicate Item", description_snapshot: "Second specification", make_snapshot: "Original mode", unit_snapshot: "kg", quantity: 2, unit_rate: 200, gst_rate: 18, total_amount: 472 },
    { item_master_id: "removed", item_header_snapshot: "Removed Item", description_snapshot: "Removed specification", quantity: 3, unit_rate: 50, gst_rate: 18, total_amount: 177 },
  ];
  const currentItems = [
    { ...baseItems[0], description_snapshot: "First revised specification" },
    { ...baseItems[1], quantity: 4, unit_rate: 220, total_amount: 1038.4 },
    { item_master_id: "added", item_header_snapshot: "Added Item", description_snapshot: "Added specification", make_snapshot: "New mode", unit_snapshot: "kg", quantity: 1, unit_rate: 300, gst_rate: 18, total_amount: 354 },
  ];
  const terms = Array.from({ length: 22 }, (_, index) => ({ id: `clause-${index + 1}`, sort_order: index + 1, heading: index === 0 ? "Order of Precedence" : index === 4 ? "Payment Revised" : `Clause ${index + 1}`, clause_body: index === 0 ? "Body for clause 1. Testing terms also" : index === 4 ? "Payment Revised body" : `Body for clause ${index + 1}` }));
  const previousTerms = [...terms.map((term) => ({ ...term, heading: term.id === "clause-5" ? "Payment" : term.heading, clause_body: term.id === "clause-5" ? "Payment body" : term.clause_body })).filter((term) => term.id !== "clause-9"), { id: "removed-clause", sort_order: 99, heading: "Removed Clause", clause_body: "Removed clause body" }];
  const fields = { wo_number: "ISBTCHINTPURNI/MRC/101", wo_date: "2026-10-08", wo_type: "Consultant", description: "Original description", company_id: "company-id", site_id: "site-id", work_order_key_terms: { inclusions: ["csdcdfv"], exclusions: ["cdvffv"], additional: [{ label: "Payment", value: "Net 30" }, { label: "Removed Key", value: "Delete me" }] }, standard_terms_clauses: previousTerms, letterhead_snapshot: null };
  const previous = { revision_number: 0, snapshot: { fields, totals: { wo_value: 500, total_basic_amount: 500, total_gst_amount: 90, total_amount: 590 }, items: baseItems } };
  const current = { revision_number: 1, applicable_date: "2026-11-01", created_at: "2026-10-09T10:00:00.000Z", snapshot: { fields: { ...fields, wo_type: "Contractor", description: "Revised description", work_order_key_terms: { additional: [{ label: "Payment", value: "Advance" }, { label: "new head", value: "testing, testing revision" }], exclusions: ["cdvffv, this too, testing revision"], inclusions: ["csdcdfv, tetsing this"] }, standard_terms_clauses: terms }, totals: { wo_value: 800, total_basic_amount: 800, total_gst_amount: 144, total_amount: 944 }, items: currentItems } };
  const context = { company_name: "MRC Infracon Limited", site_name: "Bus Stand, Chintpurni", original_wo_date: "2026-10-08", created_by: "creator-id", created_by_name: "Creator Name", created_by_email: "creator@example.test", created_at: current.created_at, vendor_snapshot: { vendor_name: "Design Well India Pvt. Ltd.", address: "Test vendor address", contact_person: "Vendor Person", phone: "9999999999", email: "vendor@example.test", gstin: "GSTIN123" } };
  const revisionBytes = await renderPilotRevisionPdf(current, previous, context);
  const normalBytes = await renderWorkOrderPdf({ wo_number: "R0/TEST", wo_date: "2026-10-08", company: { company_name: context.company_name }, site: { site_name: context.site_name }, vendor_snapshot: context.vendor_snapshot, items: [] }, { header: null, footer: null });
  const revisionPdf = await PDFDocument.load(revisionBytes);
  const normalPdf = await PDFDocument.load(normalBytes);
  const streams = (pdf) => pdf.getPages().flatMap((page) => page.node.Contents().asArray().map((ref) => { const stream = pdf.context.lookup(ref); return inflateSync(Buffer.from(stream.getContents())).toString("latin1"); })).join("\n");
  const decodeText = (input) => input.replace(/<([0-9A-Fa-f]+)> Tj/g, (_, hex) => Buffer.from(hex, "hex").toString("utf8"));
  const revisionRawStreams = streams(revisionPdf);
  const revisionStreams = decodeText(revisionRawStreams);
  const normalStreams = decodeText(streams(normalPdf));
  for (const expected of ["MRC Infracon Limited", "Bus Stand, Chintpurni", "Design Well India Pvt. Ltd.", "ISBTCHINTPURNI/MRC/101", "WO Revision Applicable Date", "01/11/2026", "Order of Precedence", "Testing terms also", "First revised specification", "New mode", "csdcdfv", "tetsing", "this", "cdvffv", "too,", "testing", "revision", "new head", "testing, testing revision", "Payment", "Net", "30", "Advance", "Removed Key", "Delete", "me", "Added specification", "Removed Item", "Removed specification", "Removed Clause", "Removed clause body"]) assert.match(revisionStreams, new RegExp(expected.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `missing ${expected}`);
  assert.match(revisionStreams, /Upon issuance of this Revised Work Order, the previous Work Order/);
  assert.match(revisionStreams, /Original Work Order Date/);
  assert.match(revisionStreams, /08\/10\/2026/);
  assert.match(revisionStreams, /Created By/);
  assert.match(revisionStreams, /Creator Name/);
  assert.match(revisionStreams, /creator@example.test/);
  const revision2Bytes = await renderPilotRevisionPdf({ ...current, revision_number: 2, applicable_date: "2026-12-01", created_at: "2026-11-09T10:00:00.000Z" }, previous, context);
  const revision2Streams = decodeText(streams(await PDFDocument.load(revision2Bytes)));
  assert.match(revision2Streams, /08\/10\/2026/);
  assert.match(revision2Streams, /01\/12\/2026/);
  assert.doesNotMatch(revisionStreams, /company_id|site_id|description_snapshot|REVISION REDLINES|company-id|site-id/);
  assert.match(revisionStreams, /0\.78 0\.05 0\.05/);
  assert.match(revisionStreams, /0\.05 0\.05 0\.05 RG[\s\S]*\nS\n/);
  const termsStart = revisionRawStreams.indexOf(`<${Buffer.from("Order of Precedence", "utf8").toString("hex").toUpperCase()}>`);
  const termsEnd = revisionRawStreams.indexOf(`<${Buffer.from("Body for clause 22", "utf8").toString("hex").toUpperCase()}>`);
  assert.ok(termsStart >= 0 && termsEnd > termsStart, "missing generated T&C boundaries");
  assert.doesNotMatch(revisionRawStreams.slice(termsStart, termsEnd + 300), /0\.05 0\.05 0\.05 RG[\s\S]*\nS\n/, "T&C text must not emit strikethrough operators");
  const colorBefore = (text) => { const encoded = Buffer.from(text, "utf8").toString("hex").toUpperCase(); const at = revisionRawStreams.indexOf(`<${encoded}>`); assert.ok(at >= 0, `missing encoded ${text}`); return revisionRawStreams.slice(Math.max(0, at - 220), at); };
  const unchangedBodyHex = Buffer.from("Body for clause 2", "utf8").toString("hex").toUpperCase();
  const unchangedBodyAt = revisionRawStreams.indexOf(`<${unchangedBodyHex}>`);
  assert.ok(unchangedBodyAt >= 0, "missing unchanged clause body");
  assert.doesNotMatch(revisionRawStreams.slice(Math.max(0, unchangedBodyAt - 220), unchangedBodyAt + unchangedBodyHex.length + 20), /0\.05 0\.05 0\.05 RG[\s\S]*\nS\n/, "unchanged clause must not be struck");
  assert.match(colorBefore("csdcdfv"), /0\.05 0\.08 0\.12 rg/);
  assert.match(colorBefore("cdvffv"), /0\.05 0\.08 0\.12 rg/);
  assert.match(colorBefore("tetsing"), /0\.78 0\.05 0\.05 rg/);
  assert.match(colorBefore("New mode"), /0\.78 0\.05 0\.05 rg/);
  assert.match(colorBefore("01/11/2026"), /0\.78 0\.05 0\.05 rg/);
  const addedItemHex = Buffer.from("Added Item", "utf8").toString("hex").toUpperCase();
  assert.match(revisionRawStreams, new RegExp(`0\\.78 0\\.05 0\\.05 rg[\\s\\S]{0,500}<${addedItemHex}> Tj`));
  for (const total of ["Rs. 650.00", "Rs. 1,280.00", "Rs. 117.00", "Rs. 230.40", "Rs. 767.00", "Rs. 1,510.40"]) assert.match(revisionStreams, new RegExp(total.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `missing total ${total}`);
  assert.match(colorBefore("Net"), /0\.05 0\.05 0\.05 rg/);
  assert.match(colorBefore("30"), /0\.05 0\.05 0\.05 rg/);
  assert.match(colorBefore("Advance"), /0\.78 0\.05 0\.05 rg/);
  assert.match(colorBefore("Delete"), /0\.05 0\.05 0\.05 rg/);
  assert.match(colorBefore("me"), /0\.05 0\.05 0\.05 rg/);
  assert.match(revisionRawStreams, /0\.05 0\.05 0\.05 rg[\s\S]*0\.05 0\.05 0\.05 RG[\s\S]*S/);
  assert.doesNotMatch(normalStreams, /0\.78 0\.05 0\.05|WO Revision Applicable Date|Upon issuance of this Revised Work Order/);
  assert.ok(revisionBytes.length > 0, "preview PDF must contain the exact bytes returned for submission");
  fs.writeFileSync("/private/tmp/work-order-pilot-revision-fixture.pdf", revisionBytes);
  console.log(`Rendered revision PDF fixture passed (${revisionPdf.getPageCount()} pages; normal ${normalPdf.getPageCount()}).`);
} finally {
  for (const file of [rendererPath, revisionsPath, adapterPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
}
