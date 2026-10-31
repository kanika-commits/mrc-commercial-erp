import fs from "node:fs/promises";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { renderPilotRaBillPdf } from "../lib/workOrderPilotRaBillPdf.server.ts";

const items = Array.from({ length: 18 }, (_, index) => ({
  parent_serial: String(index + 1),
  description: `Synthetic work item ${index + 1} with a longer description for wrapping and pagination`,
  wo_qty: 100 + index,
  unit: "Nos.",
  rate: 1250 + index * 25,
  cumulative_qty: 20 + index,
  remarks: index % 3 === 0 ? "Synthetic remark" : "",
  breakdowns: index % 4 === 1 ? [
    { id: `child-${index}-1`, serial: `${index + 1}.1`, description: "First breakdown activity", cumulative_qty: 10, release_percent: 50, previous_amount: 1000, remarks: "Child note" },
    { id: `child-${index}-2`, serial: `${index + 1}.2`, description: "Second breakdown activity", cumulative_qty: 8, release_percent: 100, previous_amount: 500, remarks: "" },
  ] : [],
}));

await fs.mkdir("tmp/pdfs/pilot-ra-bill-fixture", { recursive: true });
const makeBill = (selectedItems, billNumber) => {
  const calculationItems = selectedItems.map((item) => ({
    serial: item.parent_serial,
    cumulative_qty: item.cumulative_qty,
    release_percent: item.breakdowns.length ? 0.72 : 0.85,
    cumulative_amount: item.rate * item.cumulative_qty * 0.85,
    previous_amount: 1000,
    current_amount: item.rate * item.cumulative_qty * 0.85 - 1000,
    breakdowns: item.breakdowns.map((child) => ({ ...child, cumulative_amount: item.rate * child.cumulative_qty * (child.release_percent / 100), current_amount: item.rate * child.cumulative_qty * (child.release_percent / 100) - child.previous_amount })),
  }));
  return {
    work_order_id: "fixture-work-order",
    bill_number: billNumber,
    bill_date: "2026-10-12",
    bill_period: "2026-09-07 to 2026-09-30",
    work_order_snapshot: { vendor_name: "Synthetic Contractor Pvt. Ltd.", site_name: "Synthetic Test Site", description: "Synthetic site development and civil works" },
    calculation_snapshot: { items: calculationItems, cumulative_basic: 593269.28, current_basic: 593269.28, cumulative_gst: 44100, current_gst: 32400, cumulative_security: 500, current_security: 500, withheld: 500, labour_cess: 0, cumulative_net_payable: 592769.28, current_net_payable: 592769.28, adjusted_net_payable: 592269.28 },
    work_order_pilot_ra_bill_items: selectedItems,
  };
};
const order = { wo_number: "SYNTH/MRC/001", description: "Synthetic site development and civil works", work_order_vendors: [{ is_primary: true, vendors: { vendor_name: "Synthetic Vendor Relationship Ltd." } }], company: [{ company_name: "Must not be used as vendor" }], site: [{ site_name: "Synthetic Test Site" }], effective_items: items.map((item) => ({ serial: item.parent_serial, quantity: item.wo_qty, unit: item.unit, unit_rate: item.rate })) };
const verifyFixture = async (selectedItems, billNumber, output, expectedPages, minBytes) => {
  const bill = makeBill(selectedItems, billNumber);
  const bytes = await renderPilotRaBillPdf({ bill, order, effectiveRevision: { revision_number: 2, status: "approved" } });
  await fs.writeFile(output, bytes);
  const pdf = await PDFDocument.load(bytes);
  if (expectedPages === "one" && pdf.getPageCount() !== 1) throw new Error(`Expected short fixture to fit on one page, got ${pdf.getPageCount()}`);
  if (expectedPages === "many" && pdf.getPageCount() < 2) throw new Error(`Expected long fixture pagination, got ${pdf.getPageCount()} page`);
  if (bytes.length < minBytes) throw new Error("Fixture PDF is unexpectedly small; expected the complete rendered table and summary");
  const rawPdf = Buffer.from(bytes).toString("latin1");
  const extractedStreams = [...rawPdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => { const encoded = Buffer.from(match[1], "latin1"); try { return zlib.inflateSync(encoded).toString("latin1"); } catch { return encoded.toString("latin1"); } }).join("\n");
  const normalizedText = extractedStreams.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex) => Buffer.from(hex, "hex").toString("latin1")).replace(/\s+/g, " ");
  if (normalizedText.includes("PILOT RA BILL") || normalizedText.includes("Cumulative qty") || normalizedText.includes("TOTALS") || normalizedText.includes("exact reviewed artifact submitted")) throw new Error("Fixture PDF contains removed Pilot PDF wording/layout");
  if (normalizedText.includes(">-<") || /\s-\s-\s/.test(normalizedText)) throw new Error("Fixture PDF contains placeholder dashes in non-applicable table cells");
  if (normalizedText.includes("Must not be used as vendor")) throw new Error("Fixture PDF used company as the vendor");
  if (!normalizedText.includes("% of Current Basic")) throw new Error("Fixture PDF is missing the percentage summary column");
  if (!normalizedText.includes("0.08%")) throw new Error("Fixture PDF is missing the expected 0.08% adjustment percentage");
  if (!normalizedText.includes("Security in this bill") || !normalizedText.includes("Withheld") || !normalizedText.includes("Labour Cess")) throw new Error("Fixture PDF is missing adjustment summary labels");
  return { pages: pdf.getPageCount(), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), output };
};
const shortResult = await verifyFixture(items.slice(0, 2), "RA-001", "tmp/pdfs/pilot-ra-bill-fixture/pilot-ra-bill-short-fixture.pdf", "one", 3000);
const longResult = await verifyFixture(items, "RA-018", "tmp/pdfs/pilot-ra-bill-fixture/pilot-ra-bill-fixture.pdf", "many", 10000);
console.log(JSON.stringify({ short: shortResult, long: longResult }));
