import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

const tmpDir = path.resolve("tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const rendererPath = path.join(tmpDir, `approved-work-order-renderer-${process.pid}.ts`);
const rendererUrl = pathToFileURL(rendererPath).href;
const signaturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

try {
  fs.writeFileSync(rendererPath, fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8").replace(
    'import { adminClient } from "@/lib/serverProcurementAccess";',
    "const adminClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }) }) }), storage: { from: () => ({ download: async () => ({ data: null }) }) } });",
  ));
  const { renderWorkOrderPdf } = await import(`${rendererUrl}?fixture=${Date.now()}`);
  const bytes = await renderWorkOrderPdf({
    wo_number: "SAN/WO/001",
    wo_date: "2026-11-23",
    approval_status: "approved",
    company: { company_name: "Sanitized Company" },
    site: { site_name: "Sanitized Site" },
    vendor_snapshot: { vendor_name: "Sanitized Vendor", address: "Vendor Address", contact_person: "Vendor Contact", phone: "0000000000", email: "vendor@example.test", gstin: "TESTGSTIN" },
    delivery_snapshot: {
      gst_billing: { gstin: "SAN-GST-001", legal_name: "Sanitized Company", address_line1: "Billing Street", city: "Billing City", state: "Billing State", pincode: "110001" },
      billing_contact: { contact_name: "Billing Contact", mobile: "0000000001", email: "billing@example.test" },
      delivery_location: { location_name: "Sanitized Site", address: "Delivery Street, Delivery City, Delivery State 110002", gstin: "SAN-GST-001" },
      delivery_contact: { contact_name: "Delivery Contact", mobile: "0000000002", email: "delivery@example.test" },
    },
    approval_signature_block: { employeeName: "Approver Example", designation: "Approver Title" },
    approval_signature_asset: { data: signaturePng, width: 1, height: 1, format: "png" },
    items: [{ item_header_snapshot: "Sanitized item", description_snapshot: "Sanitized description", unit_snapshot: "Each", quantity: 1, unit_rate: 100, gst_rate: 18, total_amount: 118 }],
    total_basic_amount: 100,
    total_gst_amount: 18,
    total_amount: 118,
    standard_terms_snapshot: "1. Sanitized term",
  }, { header: null, footer: null });

  const output = "/private/tmp/work-order-approved-sanitized.pdf";
  fs.writeFileSync(output, bytes);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  const raw = pdf.getPages().flatMap((page) => page.node.Contents().asArray().map((ref) => {
    const stream = pdf.context.lookup(ref);
    const contents = stream.getContents();
    try { return inflateSync(Buffer.from(contents)).toString("latin1"); } catch { return Buffer.from(contents).toString("latin1"); }
  })).join("\n");
  const text = raw.replace(/<([0-9A-Fa-f]+)> Tj/g, (_, hex) => Buffer.from(hex, "hex").toString("utf8"));
  for (const expected of ["Sanitized Vendor", "Vendor Address", "Sanitized Company", "Sanitized Site", "Billing Street", "Delivery Street", "Billing Contact", "Delivery Contact", "Approved By", "For: Sanitized Company", "Signature:", "Name: Approver Example", "Designation: Approver Title"]) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing rendered text: ${expected}`);
  }
  assert.doesNotMatch(text, /DRAFT/);
  assert.doesNotMatch(text, /Approved At/);
  const order = ["Approved By", "For: Sanitized Company", "Signature:", "Name: Approver Example", "Designation: Approver Title"].map((label) => text.indexOf(label));
  assert.ok(order.every((position) => position >= 0), "approval block text missing from rendered output");
  console.log(`Approved Work Order sanitized rendering passed (${pdf.getPageCount()} page(s)); output: ${output}`);
} finally {
  if (fs.existsSync(rendererPath)) fs.unlinkSync(rendererPath);
}
