#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE =
  "reports/work-order-vendor-links/missing_vendors_to_create.csv";

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
  node scripts/import-missing-vendors.mjs
  node scripts/import-missing-vendors.mjs --source reports/work-order-vendor-links/missing_vendors_to_create.csv

Imports missing vendors only. Existing vendors are never modified.
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

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private)\b/g, "private")
    .replace(/\b(ltd|limited)\b/g, "limited")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }

  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const supabase = adminClient();
  const existingVendors = await fetchAll(
    supabase,
    "vendors",
    "id, organization_id, vendor_name"
  );
  const existingKeys = new Set(
    existingVendors.map(
      (vendor) =>
        `${vendor.organization_id || ""}:${normalizeName(vendor.vendor_name)}`
    )
  );
  const seenCsvKeys = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const organizationId = row.organization_id;
    const vendorName = row.vendor_name;
    const vendorType = row.vendor_type || "Contractor";
    const status = row.status || "active";
    const normalizedVendorName = normalizeName(vendorName);
    const key = `${organizationId}:${normalizedVendorName}`;

    if (!organizationId || !vendorName || !normalizedVendorName) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        reason: "Missing organization_id or vendor_name.",
      });
      continue;
    }

    if (seenCsvKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    seenCsvKeys.add(key);

    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }

    const { error } = await supabase.from("vendors").insert({
      organization_id: organizationId,
      vendor_name: vendorName,
      vendor_type: vendorType,
      status,
    });

    if (error) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        vendor_name: vendorName,
        reason: error.message,
      });
    } else {
      inserted += 1;
      existingKeys.add(key);
    }
  }

  const { count: totalVendorCount, error: countError } = await supabase
    .from("vendors")
    .select("id", { count: "exact", head: true });

  if (countError) throw countError;

  console.log("missing vendors import complete");
  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        source_rows: rows.length,
        inserted,
        skipped,
        duplicates,
        total_vendor_count: totalVendorCount || 0,
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
