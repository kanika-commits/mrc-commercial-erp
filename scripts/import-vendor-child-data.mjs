#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE_DIR = "reports/vendor-child-data-import";

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
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") {
      args.sourceDir = argv[++index] || "";
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
  node scripts/import-vendor-child-data.mjs
  node scripts/import-vendor-child-data.mjs --source-dir reports/vendor-child-data-import

Imports vendor contacts, GSTINs, and bank accounts from dry-run SQL-ready CSVs.
Existing rows are never modified.
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

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("@") ? text : "";
}

function normalizeGstin(value) {
  return String(value || "").replace(/[^0-9A-Za-z]+/g, "").toUpperCase();
}

function normalizeAccount(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeIfsc(value) {
  return String(value || "").replace(/[^0-9A-Za-z]+/g, "").toUpperCase();
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

function readSource(sourceDir, fileName) {
  const sourcePath = path.resolve(sourceDir, fileName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }
  return parseCsv(fs.readFileSync(sourcePath, "utf8"));
}

async function importContacts(supabase, sourceDir) {
  const rows = readSource(sourceDir, "vendor_contacts_sql_ready.csv");
  const existing = await fetchAll(
    supabase,
    "vendor_contacts",
    "id,vendor_id,contact_name,contact_number,email"
  );
  const vendors = await fetchAll(supabase, "vendors", "id");
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));
  const existingKeys = new Set(
    existing.map(
      (row) =>
        `${row.vendor_id}:${normalizeName(row.contact_name)}:${normalizePhone(
          row.contact_number
        )}:${normalizeEmail(row.email)}`
    )
  );
  const seen = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const key = `${row.vendor_id}:${normalizeName(row.contact_name)}:${normalizePhone(
      row.contact_number
    )}:${normalizeEmail(row.email)}`;

    if (!row.organization_id || !row.vendor_id || !row.contact_name || !vendorIds.has(row.vendor_id)) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: "Missing fields or vendor_id not found." });
      continue;
    }

    if (existingKeys.has(key) || seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const { error } = await supabase.from("vendor_contacts").insert({
      organization_id: row.organization_id,
      vendor_id: row.vendor_id,
      contact_name: row.contact_name,
      contact_number: row.contact_number || null,
      email: row.email || null,
      designation: row.designation || null,
      is_primary: row.is_primary === "true",
    });

    if (error) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: error.message });
    } else {
      inserted += 1;
      existingKeys.add(key);
    }
  }

  return { source_rows: rows.length, inserted, skipped, duplicates, errors };
}

async function importGstins(supabase, sourceDir) {
  const rows = readSource(sourceDir, "vendor_gstins_sql_ready.csv");
  const existing = await fetchAll(supabase, "vendor_gstins", "id,vendor_id,gstin");
  const vendors = await fetchAll(supabase, "vendors", "id");
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));
  const existingKeys = new Set(
    existing.map((row) => `${row.vendor_id}:${normalizeGstin(row.gstin)}`)
  );
  const seen = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const key = `${row.vendor_id}:${normalizeGstin(row.gstin)}`;

    if (!row.organization_id || !row.vendor_id || !row.gstin || !vendorIds.has(row.vendor_id)) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: "Missing fields or vendor_id not found." });
      continue;
    }

    if (existingKeys.has(key) || seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const { error } = await supabase.from("vendor_gstins").insert({
      organization_id: row.organization_id,
      vendor_id: row.vendor_id,
      gstin: normalizeGstin(row.gstin),
      state_code: row.state_code || normalizeGstin(row.gstin).slice(0, 2),
      state_name: row.state_name || null,
      is_primary: row.is_primary === "true",
    });

    if (error) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: error.message });
    } else {
      inserted += 1;
      existingKeys.add(key);
    }
  }

  return { source_rows: rows.length, inserted, skipped, duplicates, errors };
}

async function importBankAccounts(supabase, sourceDir) {
  const rows = readSource(sourceDir, "vendor_bank_accounts_sql_ready.csv");
  const existing = await fetchAll(
    supabase,
    "vendor_bank_accounts",
    "id,vendor_id,account_number,ifsc_code"
  );
  const vendors = await fetchAll(supabase, "vendors", "id");
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));
  const existingKeys = new Set(
    existing.map(
      (row) =>
        `${row.vendor_id}:${normalizeAccount(row.account_number)}:${normalizeIfsc(
          row.ifsc_code
        )}`
    )
  );
  const seen = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const key = `${row.vendor_id}:${normalizeAccount(row.account_number)}:${normalizeIfsc(
      row.ifsc_code
    )}`;

    if (
      !row.organization_id ||
      !row.vendor_id ||
      !row.account_number ||
      !row.ifsc_code ||
      !vendorIds.has(row.vendor_id)
    ) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: "Missing fields or vendor_id not found." });
      continue;
    }

    if (existingKeys.has(key) || seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const { error } = await supabase.from("vendor_bank_accounts").insert({
      organization_id: row.organization_id,
      vendor_id: row.vendor_id,
      account_holder_name: row.account_holder_name || null,
      account_number: normalizeAccount(row.account_number),
      ifsc_code: normalizeIfsc(row.ifsc_code),
      bank_name: row.bank_name || null,
      branch_name: row.branch_name || null,
      is_primary: row.is_primary === "true",
    });

    if (error) {
      skipped += 1;
      errors.push({ row: row.__row_number, reason: error.message });
    } else {
      inserted += 1;
      existingKeys.add(key);
    }
  }

  return { source_rows: rows.length, inserted, skipped, duplicates, errors };
}

async function countTable(supabase, table) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const sourceDir = path.resolve(args.sourceDir);
  const supabase = adminClient();
  const contacts = await importContacts(supabase, sourceDir);
  const gstins = await importGstins(supabase, sourceDir);
  const bankAccounts = await importBankAccounts(supabase, sourceDir);

  console.log("vendor child data import complete");
  console.log(
    JSON.stringify(
      {
        source_dir: sourceDir,
        contacts,
        gstins,
        bank_accounts: bankAccounts,
        final_counts: {
          vendor_contacts: await countTable(supabase, "vendor_contacts"),
          vendor_gstins: await countTable(supabase, "vendor_gstins"),
          vendor_bank_accounts: await countTable(supabase, "vendor_bank_accounts"),
        },
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
