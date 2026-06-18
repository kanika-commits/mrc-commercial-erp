#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE = "reports/drive-folder-backfill/backfill_sql_ready.csv";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || "").trim()]))
  );
}

async function fetchAll(admin, table, select) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function validateRow(row) {
  const required = [
    "organization_id",
    "work_order_id",
    "drive_folder_id",
    "drive_folder_name",
    "ra_bills_folder_id",
    "invoices_folder_id",
    "debit_notes_folder_id",
    "contractor_docs_folder_id",
  ];

  return required.filter((column) => !row[column]);
}

async function main() {
  loadEnv();

  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing ${SOURCE}. Run dry-run-backfill-work-order-drive-folders.mjs first.`);
  }

  const admin = adminClient();
  const rows = parseCsv(fs.readFileSync(SOURCE, "utf8"));
  const [workOrders, existingRows] = await Promise.all([
    fetchAll(admin, "work_orders", "id"),
    fetchAll(admin, "work_order_drive_folders", "work_order_id, drive_folder_id"),
  ]);

  const workOrderIds = new Set(workOrders.map((row) => row.id));
  const existingByWorkOrderId = new Set(existingRows.map((row) => row.work_order_id).filter(Boolean));
  const existingDriveFolderIds = new Set(existingRows.map((row) => row.drive_folder_id).filter(Boolean));

  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;
  let errors = 0;

  for (const row of rows) {
    const missing = validateRow(row);
    if (missing.length > 0) {
      errors += 1;
      console.error(`error ${row.work_order_id || "(missing work_order_id)"}: missing ${missing.join(", ")}`);
      continue;
    }

    if (!workOrderIds.has(row.work_order_id)) {
      errors += 1;
      console.error(`error ${row.work_order_id}: work_order_id does not exist`);
      continue;
    }

    if (existingByWorkOrderId.has(row.work_order_id)) {
      duplicates += 1;
      continue;
    }

    if (existingDriveFolderIds.has(row.drive_folder_id)) {
      duplicates += 1;
      continue;
    }

    const { error } = await admin.from("work_order_drive_folders").insert({
      organization_id: row.organization_id,
      work_order_id: row.work_order_id,
      drive_folder_id: row.drive_folder_id,
      drive_folder_name: row.drive_folder_name,
      ra_bills_folder_id: row.ra_bills_folder_id,
      invoices_folder_id: row.invoices_folder_id,
      debit_notes_folder_id: row.debit_notes_folder_id,
      contractor_docs_folder_id: row.contractor_docs_folder_id,
    });

    if (error) {
      errors += 1;
      console.error(`error ${row.work_order_id}: ${error.message}`);
      continue;
    }

    inserted += 1;
    existingByWorkOrderId.add(row.work_order_id);
    existingDriveFolderIds.add(row.drive_folder_id);
  }

  const { count, error: countError } = await admin
    .from("work_order_drive_folders")
    .select("id", { count: "exact", head: true });

  if (countError) throw countError;

  console.log(`source rows: ${rows.length}`);
  console.log(`inserted: ${inserted}`);
  console.log(`skipped: ${skipped}`);
  console.log(`duplicates: ${duplicates}`);
  console.log(`errors: ${errors}`);
  console.log(`final work_order_drive_folders count: ${count || 0}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
