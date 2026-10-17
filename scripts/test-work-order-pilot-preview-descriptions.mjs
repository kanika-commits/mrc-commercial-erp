import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";

const tmpDir = path.resolve("tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const rendererPath = path.join(tmpDir, `pilot-preview-description-renderer-${process.pid}.ts`);
const rendererUrl = pathToFileURL(rendererPath).href;
try {
  const route = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
  const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");
  assert.match(route, /item_header_snapshot: master\.item_header/);
  assert.match(route, /description_snapshot: master\.description/);
  assert.match(renderer, /item\.item_name_snapshot \|\| item\.item_header_snapshot/);
  assert.match(renderer, /item\.description_snapshot \|\| item\.specification_snapshot/);
  assert.match(renderer, /if \(line\.diff\) drawRevisionLines\(line\.diff/);
  assert.match(renderer, /else draw\(line\.text/);

  fs.writeFileSync(rendererPath, renderer.replace('import { adminClient } from "@/lib/serverProcurementAccess";', "const adminClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }) }) }), storage: { from: () => ({ download: async () => ({ data: null }) }) } });"));
  const { renderWorkOrderPdf } = await import(`${rendererUrl}?fixture=${Date.now()}`);
  const descriptions = ["Concrete foundation description", "Electrical conduit description", "Finishing and paint description"];
  const pdf = await renderWorkOrderPdf({
    company: { company_name: "Test Company" }, site: { site_name: "Test Site" },
    vendor_snapshot: { vendor_name: "Test Vendor" }, wo_number: "TEST/101", wo_date: "2026-10-17", wo_type: "Consultant",
    delivery_snapshot: {}, items: descriptions.map((description, index) => ({ item_name_snapshot: `Item ${index + 1}`, item_header_snapshot: `Item ${index + 1}`, description_snapshot: description, additional_description_snapshot: "", make_snapshot: "Mode", quantity: 1, uom_snapshot: "No.", unit_rate: 100 + index, gst_rate: 0, total_amount: 100 + index })),
    total_basic_amount: 303, total_gst_amount: 0, total_amount: 303, work_order_key_terms: { inclusions: ["Include all work"], exclusions: ["No exclusions"] }, standard_terms_snapshot: "",
  });
  const document = await PDFDocument.load(pdf);
  assert.ok(document.getPageCount() > 0, "preview must produce a valid PDF");
  const bytes = Buffer.from(pdf);
  const streams = [];
  for (const match of bytes.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)endstream/g)) { try { streams.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")); } catch {} }
  const content = streams.join("\n");
  const decoded = content.replace(/<([0-9a-f]+)>/gi, (_, hex) => Buffer.from(hex, "hex").toString("latin1"));
  for (const description of descriptions) assert.ok(decoded.includes(description), `PDF must contain ${description}`);
  console.log("Pilot Work Order preview description fixture: PASS");
} finally {
  fs.rmSync(rendererPath, { force: true });
}
