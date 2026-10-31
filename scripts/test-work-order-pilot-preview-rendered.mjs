import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

const tmpDir = path.resolve("tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const rendererPath = path.join(tmpDir, `work-order-renderer-${process.pid}.ts`);
const rendererUrl = pathToFileURL(rendererPath).href;
try {
  fs.writeFileSync(rendererPath, fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8").replace(
    'import { adminClient } from "@/lib/serverProcurementAccess";',
    "const adminClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }) }) }), storage: { from: () => ({ download: async () => ({ data: null }) }) } });",
  ));
  const { renderWorkOrderPdf } = await import(`${rendererUrl}?fixture=${Date.now()}`);
  const bytes = await renderWorkOrderPdf({
    wo_number: "SITE/WO/101",
    wo_date: "2026-10-31",
    wo_type: "Consultant",
    description: "Long description retained in the PDF",
    company: { company_name: "Example Company" },
    site: { site_name: "Example Site" },
    vendor_snapshot: { vendor_name: "Example Vendor", address: "Long vendor address" },
    items: [
      { item_header_snapshot: "Concrete placement and finishing", description_snapshot: "Multi-line specification that must wrap inside the item cell without replacing the content with placeholders", additional_description_snapshot: "Additional item note", unit_snapshot: "Cubic metre", mode_of_measurement_snapshot: "Measured work", quantity: 12, unit_rate: 1250, gst_rate: 18, total_amount: 17700 },
      { item_header_snapshot: "Second item", description_snapshot: "Second item description", unit_snapshot: "Each", quantity: 2, unit_rate: 400, gst_rate: 18, total_amount: 944 },
    ],
    total_basic_amount: 15800,
    total_gst_amount: 2844,
    total_amount: 18644,
    standard_terms_snapshot: "1. Payment\nPayment within thirty days.",
    work_order_key_terms: { inclusions: ["Included"], exclusions: ["Excluded"], additional: [] },
  }, { header: null, footer: null });

  const pdf = await PDFDocument.load(bytes);
  fs.writeFileSync("/private/tmp/work-order-preview-fixture.pdf", bytes);
  assert.ok(pdf.getPageCount() >= 1, "rendered PDF must contain a page");
  const raw = pdf.getPages().flatMap((page) => page.node.Contents().asArray().map((ref) => {
    const stream = pdf.context.lookup(ref);
    return inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  })).join("\n");
  const text = raw.replace(/<([0-9A-Fa-f]+)> Tj/g, (_, hex) => Buffer.from(hex, "hex").toString("utf8"));
  for (const expected of ["Concrete placement and finishing", "Multi-line specification", "Additional item note", "Second item", "Cubic", "metre", "Total Basic Amount", "Rs. 15,800.00", "Rs. 18,644.00"]) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing rendered PDF text: ${expected}`);
  }
  console.log(`Work Order preview PDF rendering passed (${pdf.getPageCount()} page(s))`);
} finally {
  if (fs.existsSync(rendererPath)) fs.unlinkSync(rendererPath);
}
