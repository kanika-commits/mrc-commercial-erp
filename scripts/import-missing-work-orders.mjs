#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE =
  "reports/work-order-vendor-links/missing_work_orders_sql_ready.csv";
const ALLOWED_WO_NUMBERS = new Set([
  "ESICBDH/MRC/196",
  "IIIT/MRC/169",
  "MRC/WO/R_Jammu/303",
]);

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
  node scripts/import-missing-work-orders.mjs
  node scripts/import-missing-work-orders.mjs --source reports/work-order-vendor-links/missing_work_orders_sql_ready.csv

Imports only the three approved missing Work Orders. Existing Work Orders are never modified.
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

function parseNumber(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text || text.toLowerCase() === "n/a") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function csvDateToIso(value) {
  const text = String(value || "").trim();
  if (!text || text === "0") return null;
  const number = Number(text);
  if (Number.isFinite(number) && number > 0) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + number * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return text;
}

async function duplicateExists(supabase, organizationId, woNumber) {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("wo_number", woNumber)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function fetchWorkOrderCount(supabase) {
  const { count, error } = await supabase
    .from("work_orders")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }

  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8")).filter((row) =>
    ALLOWED_WO_NUMBERS.has(row.wo_number)
  );
  const supabase = adminClient();
  const seenCsvKeys = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const organizationId = row.organization_id;
    const woNumber = row.wo_number;
    const pairKey = `${organizationId}:${woNumber}`;

    if (!organizationId || !row.company_id || !row.site_id || !woNumber) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        wo_number: woNumber,
        reason: "Missing organization_id, company_id, site_id, or wo_number.",
      });
      continue;
    }

    if (seenCsvKeys.has(pairKey)) {
      duplicates += 1;
      continue;
    }
    seenCsvKeys.add(pairKey);

    if (await duplicateExists(supabase, organizationId, woNumber)) {
      duplicates += 1;
      continue;
    }

    const insertRow = {
      organization_id: organizationId,
      company_id: row.company_id,
      site_id: row.site_id,
      wo_number: woNumber,
      wo_date: csvDateToIso(row.wo_date),
      wo_type: row.wo_type || null,
      description: row.description || null,
      status: row.status || null,
      approval_status: row.approval_status || null,
    };
    const woValue = parseNumber(row.wo_value);
    if (woValue !== null) insertRow.wo_value = woValue;

    const { error } = await supabase.from("work_orders").insert(insertRow);

    if (error) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        wo_number: woNumber,
        reason: error.message,
      });
    } else {
      inserted += 1;
    }
  }

  const totalWorkOrderCount = await fetchWorkOrderCount(supabase);

  console.log("missing Work Orders import complete");
  console.log(
    JSON.stringify(
      {
        source: sourcePath,
        allowed_target_rows: rows.length,
        inserted,
        skipped,
        duplicates,
        total_work_order_count: totalWorkOrderCount,
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
