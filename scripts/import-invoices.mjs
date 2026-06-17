#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE = "reports/invoices-import/invoices_sql_ready.csv";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;

    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = argv[++index] || "";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/import-invoices.mjs
  node scripts/import-invoices.mjs --source reports/invoices-import/invoices_sql_ready.csv

Imports Invoices only. Documents are not imported and existing rows are never modified.
`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => normalizeHeader(header));
  return rows.slice(1).map((cells, index) => {
    const object = { __row_number: index + 2 };
    headers.forEach((header, headerIndex) => {
      object[header] = String(cells[headerIndex] || "").trim();
    });
    return object;
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizedInvoiceNumber(value) {
  return String(value || "").trim().toLowerCase();
}

function numberValue(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

async function idExists(supabase, table, id) {
  if (!id) return false;
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function vendorLinkedToWorkOrder(supabase, workOrderId, vendorId) {
  const { data, error } = await supabase
    .from("work_order_vendors")
    .select("id")
    .eq("work_order_id", workOrderId)
    .eq("vendor_id", vendorId)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function existingInvoiceExists(
  supabase,
  organizationId,
  vendorId,
  invoiceNumber
) {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("organization_id", organizationId)
    .eq("vendor_id", vendorId);

  if (error) throw error;

  return (data || []).some(
    (invoice) =>
      normalizedInvoiceNumber(invoice.invoice_number) ===
      normalizedInvoiceNumber(invoiceNumber)
  );
}

async function fetchInvoiceCount(supabase) {
  const { count, error } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

function duplicateMessage(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${
    error?.constraint || ""
  }`.toLowerCase();

  if (
    error?.code === "23505" ||
    message.includes("invoices_unique_number_per_vendor_org")
  ) {
    return "Duplicate invoice number for this vendor.";
  }

  return error?.message || "Insert failed.";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }

  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const supabase = adminClient();
  const seenCsvKeys = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const organizationId = row.organization_id;
    const workOrderId = row.work_order_id;
    const vendorId = row.vendor_id;
    const invoiceNumber = row.invoice_number;
    const csvKey = `${organizationId}:${vendorId}:${normalizedInvoiceNumber(
      invoiceNumber
    )}`;

    if (!organizationId || !workOrderId || !vendorId || !invoiceNumber) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        invoice_number: invoiceNumber,
        reason:
          "Missing organization_id, work_order_id, vendor_id, or invoice_number.",
      });
      continue;
    }

    if (seenCsvKeys.has(csvKey)) {
      duplicates += 1;
      continue;
    }
    seenCsvKeys.add(csvKey);

    const [workOrderExists, vendorExists, linked, raBillExists] =
      await Promise.all([
        idExists(supabase, "work_orders", workOrderId),
        idExists(supabase, "vendors", vendorId),
        vendorLinkedToWorkOrder(supabase, workOrderId, vendorId),
        row.ra_bill_id ? idExists(supabase, "ra_bills", row.ra_bill_id) : true,
      ]);

    if (!workOrderExists || !vendorExists || !linked || !raBillExists) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        ra_bill_id: row.ra_bill_id,
        invoice_number: invoiceNumber,
        reason: [
          workOrderExists ? "" : "work_order_id not found",
          vendorExists ? "" : "vendor_id not found",
          linked ? "" : "vendor is not linked to Work Order",
          raBillExists ? "" : "ra_bill_id not found",
        ]
          .filter(Boolean)
          .join("; "),
      });
      continue;
    }

    if (
      await existingInvoiceExists(
        supabase,
        organizationId,
        vendorId,
        invoiceNumber
      )
    ) {
      duplicates += 1;
      continue;
    }

    const insertRow = {
      organization_id: organizationId,
      work_order_id: workOrderId,
      vendor_id: vendorId,
      ra_bill_id: row.ra_bill_id || null,
      invoice_number: invoiceNumber,
      invoice_date: row.invoice_date,
      taxable_amount: Math.round(numberValue(row.taxable_amount)),
      gst_rate: numberValue(row.gst_rate),
      gst_amount: Math.round(numberValue(row.gst_amount)),
      invoice_amount: Math.round(numberValue(row.invoice_amount)),
      status: row.status || null,
      approval_status: row.approval_status || null,
      itc_status: row.itc_status || null,
      remarks: row.remarks || null,
    };

    const { error } = await supabase.from("invoices").insert(insertRow);

    if (error) {
      const message = duplicateMessage(error);
      if (message.toLowerCase().includes("duplicate")) {
        duplicates += 1;
      } else {
        skipped += 1;
        errors.push({
          row: row.__row_number,
          work_order_id: workOrderId,
          vendor_id: vendorId,
          invoice_number: invoiceNumber,
          reason: message,
        });
      }
    } else {
      inserted += 1;
    }
  }

  const finalInvoiceCount = await fetchInvoiceCount(supabase);

  console.log("Invoices import complete");
  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        source_rows: rows.length,
        inserted,
        skipped,
        duplicates,
        errors,
        final_invoice_count: finalInvoiceCount,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
