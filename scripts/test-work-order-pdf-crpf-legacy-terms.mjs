import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";

const rendererPath = path.resolve("tmp", `crpf-legacy-terms-${process.pid}.ts`);
const source = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8").replace(
  'import { adminClient } from "@/lib/serverProcurementAccess";',
  "const adminClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }) }) }), storage: { from: () => ({ download: async () => ({ data: null }) }) } });",
);
fs.mkdirSync(path.dirname(rendererPath), { recursive: true });
fs.writeFileSync(rendererPath, source);
try {
  const { renderWorkOrderPdf } = await import(`${pathToFileURL(rendererPath).href}?fixture=${Date.now()}`);
  const bytes = await renderWorkOrderPdf({
    wo_type: "Consultant", wo_number: "CRPF/GLC/123", wo_date: "2026-11-02",
    company: { company_name: "Fixture Company" }, site: { site_name: "Fixture Site" }, vendor_snapshot: { vendor_name: "Fixture Vendor" },
    items: [], total_basic_amount: 0, total_gst_amount: 0, total_amount: 0,
    work_order_key_terms: { inclusions: [], exclusions: [], additional: [] },
    standard_terms_snapshot: "Order of Precedence\nThese terms govern the agreed scope.\n\nAcceptance & Authority\nCommencement of work constitutes acceptance.",
    created_by_name: "Fixture User", created_by_email: "fixture@example.test",
  }, { header: null, footer: null });
  const pdf = await PDFDocument.load(bytes);
  const raw = pdf.getPages().flatMap((page) => page.node.Contents().asArray().map((ref) => {
    const stream = pdf.context.lookup(ref);
    return inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  })).join("\n");
  assert.equal((raw.match(/<312E> Tj/g) || []).length, 1, "first legacy clause should have one number");
  assert.equal((raw.match(/<322E> Tj/g) || []).length, 1, "second legacy clause should have one number");
  const position = (text) => Math.max(raw.indexOf(text), raw.indexOf(Buffer.from(text, "utf8").toString("hex").toUpperCase()));
  assert.ok(position("Order of Precedence") < position("These terms govern"), "first description should follow its heading");
  assert.ok(position("Acceptance & Authority") < position("Commencement of work"), "second description should follow its heading");
  assert.match(source, /String\(row\.wo_number \|\| ""\)\.trim\(\)\.toUpperCase\(\) === "CRPF\/GLC\/123"/, "fallback must remain scoped to CRPF/GLC/123");
  console.log("CRPF/GLC/123 legacy Work Order terms PDF regression passed.");
} finally {
  if (fs.existsSync(rendererPath)) fs.unlinkSync(rendererPath);
}
