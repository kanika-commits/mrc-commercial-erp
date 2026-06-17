#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE = "reports/ra-bills-import/ra_bills_sql_ready.csv";

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
  node scripts/import-ra-bills.mjs
  node scripts/import-ra-bills.mjs --source reports/ra-bills-import/ra_bills_sql_ready.csv

Imports RA Bills only. Documents are not imported and existing rows are never modified.
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

function normalizedRaNumber(value) {
  return String(value || "").trim().toLowerCase();
}

function numberValue(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

async function idExists(supabase, table, id) {
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

async function existingRaBillExists(supabase, workOrderId, raNumber) {
  const { data, error } = await supabase
    .from("ra_bills")
    .select("id, ra_number")
    .eq("work_order_id", workOrderId);

  if (error) throw error;

  return (data || []).some(
    (bill) => normalizedRaNumber(bill.ra_number) === normalizedRaNumber(raNumber)
  );
}

async function fetchRaBillCount(supabase) {
  const { count, error } = await supabase
    .from("ra_bills")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

function duplicateMessage(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${
    error?.constraint || ""
  }`.toLowerCase();

  if (error?.code === "23505" || message.includes("ra_bills_unique_number_per_wo")) {
    return "Duplicate RA Bill number for this Work Order.";
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
    const workOrderId = row.work_order_id;
    const vendorId = row.vendor_id;
    const raNumber = row.ra_number;
    const csvKey = `${workOrderId}:${normalizedRaNumber(raNumber)}`;

    if (!row.organization_id || !workOrderId || !vendorId || !raNumber) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        ra_number: raNumber,
        reason: "Missing organization_id, work_order_id, vendor_id, or ra_number.",
      });
      continue;
    }

    if (seenCsvKeys.has(csvKey)) {
      duplicates += 1;
      continue;
    }
    seenCsvKeys.add(csvKey);

    const [workOrderExists, vendorExists, linked] = await Promise.all([
      idExists(supabase, "work_orders", workOrderId),
      idExists(supabase, "vendors", vendorId),
      vendorLinkedToWorkOrder(supabase, workOrderId, vendorId),
    ]);

    if (!workOrderExists || !vendorExists || !linked) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        ra_number: raNumber,
        reason: [
          workOrderExists ? "" : "work_order_id not found",
          vendorExists ? "" : "vendor_id not found",
          linked ? "" : "vendor is not linked to Work Order",
        ]
          .filter(Boolean)
          .join("; "),
      });
      continue;
    }

    if (await existingRaBillExists(supabase, workOrderId, raNumber)) {
      duplicates += 1;
      continue;
    }

    const insertRow = {
      organization_id: row.organization_id,
      work_order_id: workOrderId,
      vendor_id: vendorId,
      ra_number: raNumber,
      ra_date: row.ra_date,
      gross_amount: numberValue(row.gross_amount),
      recovery_amount: numberValue(row.security_amount),
      retention_amount: 0,
      gst_rate: numberValue(row.gst_rate),
      gst_amount: numberValue(row.gst_amount),
      net_amount: numberValue(row.net_amount),
      status: row.status || null,
      approval_status: row.approval_status || null,
      remarks: row.remarks || null,
    };

    const { error } = await supabase.from("ra_bills").insert(insertRow);

    if (error) {
      const message = duplicateMessage(error);
      if (message.toLowerCase().includes("duplicate")) {
        duplicates += 1;
      } else {
        skipped += 1;
        errors.push({
          row: row.__row_number,
          work_order_id: workOrderId,
          ra_number: raNumber,
          reason: message,
        });
      }
    } else {
      inserted += 1;
    }
  }

  const finalRaBillCount = await fetchRaBillCount(supabase);

  console.log("RA Bills import complete");
  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        source_rows: rows.length,
        inserted,
        skipped,
        duplicates,
        errors,
        final_ra_bill_count: finalRaBillCount,
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
