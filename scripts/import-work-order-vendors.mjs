#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE =
  "reports/work-order-vendor-links/work_order_vendor_sql_ready.csv";

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
  node scripts/import-work-order-vendors.mjs
  node scripts/import-work-order-vendors.mjs --source reports/work-order-vendor-links/work_order_vendor_sql_ready.csv

Imports only rows from the SQL-ready CSV into work_order_vendors.
No Work Orders, Vendors, RA Bills, Invoices, Debit Notes, or Payments are modified.
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

function boolValue(value) {
  return ["true", "1", "yes", "y"].includes(String(value || "").toLowerCase());
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

async function existingLinkExists(supabase, workOrderId, vendorId) {
  const { data, error } = await supabase
    .from("work_order_vendors")
    .select("id")
    .eq("work_order_id", workOrderId)
    .eq("vendor_id", vendorId)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function fetchAll(supabase, table, select) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data || []));

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function validateCoverage(supabase) {
  const [workOrders, links] = await Promise.all([
    fetchAll(supabase, "work_orders", "id"),
    fetchAll(supabase, "work_order_vendors", "work_order_id"),
  ]);
  const linkedWorkOrderIds = new Set(
    links.map((link) => link.work_order_id).filter(Boolean)
  );

  return {
    total_work_orders: workOrders.length,
    work_orders_with_vendor: linkedWorkOrderIds.size,
    work_orders_without_vendor: workOrders.length - linkedWorkOrderIds.size,
  };
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
  const seenInCsv = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicate = 0;

  for (const row of rows) {
    const organizationId = row.organization_id;
    const workOrderId = row.work_order_id;
    const vendorId = row.vendor_id;
    const vendorRole = row.vendor_role || "Main Contractor";
    const isPrimary = boolValue(row.is_primary);
    const pairKey = `${workOrderId}:${vendorId}`;

    if (!organizationId || !workOrderId || !vendorId) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        reason: "Missing organization_id, work_order_id, or vendor_id.",
      });
      continue;
    }

    if (seenInCsv.has(pairKey)) {
      duplicate += 1;
      continue;
    }
    seenInCsv.add(pairKey);

    const [workOrderExists, vendorExists] = await Promise.all([
      idExists(supabase, "work_orders", workOrderId),
      idExists(supabase, "vendors", vendorId),
    ]);

    if (!workOrderExists || !vendorExists) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        reason: `${workOrderExists ? "" : "work_order_id not found"}${
          !workOrderExists && !vendorExists ? "; " : ""
        }${vendorExists ? "" : "vendor_id not found"}`,
      });
      continue;
    }

    if (await existingLinkExists(supabase, workOrderId, vendorId)) {
      duplicate += 1;
      continue;
    }

    const { error } = await supabase.from("work_order_vendors").insert({
      organization_id: organizationId,
      work_order_id: workOrderId,
      vendor_id: vendorId,
      vendor_role: vendorRole,
      is_primary: isPrimary,
    });

    if (error) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        reason: error.message,
      });
    } else {
      inserted += 1;
    }
  }

  const validation = await validateCoverage(supabase);

  console.log("work_order_vendors import complete");
  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        source_rows: rows.length,
        inserted,
        skipped,
        duplicate,
        validation,
        errors,
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
