#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCES = {
  work_order_files: "reports/drive-document-links/work_order_files_sql_ready.csv",
  ra_bill_documents: "reports/drive-document-links/ra_bill_documents_sql_ready.csv",
  invoice_documents: "reports/drive-document-links/invoice_documents_sql_ready.csv",
  vendor_documents: "reports/drive-document-links/vendor_documents_sql_ready.csv",
};

const TABLES = {
  work_order_files: {
    source: SOURCES.work_order_files,
    table: "work_order_documents",
    parentTable: "work_orders",
    parentIdColumn: "work_order_id",
    insertColumns: [
      "organization_id",
      "work_order_id",
      "file_name",
      "file_url",
      "file_path",
      "uploaded_at",
    ],
  },
  ra_bill_documents: {
    source: SOURCES.ra_bill_documents,
    table: "ra_bill_documents",
    parentTable: "ra_bills",
    parentIdColumn: "ra_bill_id",
    insertColumns: [
      "organization_id",
      "ra_bill_id",
      "file_name",
      "file_url",
      "uploaded_at",
    ],
  },
  invoice_documents: {
    source: SOURCES.invoice_documents,
    table: "invoice_documents",
    parentTable: "invoices",
    parentIdColumn: "invoice_id",
    insertColumns: [
      "organization_id",
      "invoice_id",
      "file_name",
      "file_url",
      "uploaded_at",
    ],
  },
  vendor_documents: {
    source: SOURCES.vendor_documents,
    table: "vendor_documents",
    parentTable: "vendors",
    parentIdColumn: "vendor_id",
    insertColumns: [
      "organization_id",
      "vendor_id",
      "document_type",
      "file_name",
      "file_url",
      "uploaded_at",
    ],
  },
};

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

function readRows(source) {
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }
  return parseCsv(fs.readFileSync(sourcePath, "utf8"));
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

async function tableExists(supabase, table) {
  const { error } = await supabase.from(table).select("id").limit(1);
  if (!error) return true;
  const message = String(error.message || "").toLowerCase();
  if (message.includes("could not find the table") || message.includes("schema cache")) {
    return false;
  }
  throw error;
}

async function fetchAll(supabase, table, select) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;

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

async function fetchCount(supabase, table) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

function insertPayload(row, columns) {
  const payload = {};
  for (const column of columns) {
    if (column in row && row[column] !== "") {
      payload[column] = row[column];
    }
  }
  if ("file_path" in payload === false && columns.includes("file_path")) {
    payload.file_path = row.file_id || row.file_url;
  }
  if (!payload.uploaded_at && columns.includes("uploaded_at")) {
    payload.uploaded_at = new Date().toISOString();
  }
  return payload;
}

function duplicateKey(row, parentIdColumn) {
  return `${row[parentIdColumn]}:${normalized(row.file_id)}:${normalized(row.file_url)}`;
}

async function importTable(supabase, key, config) {
  const rows = readRows(config.source);
  const result = {
    table: config.table,
    sourceRows: rows.length,
    inserted: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    finalCount: 0,
    messages: [],
  };

  if (!(await tableExists(supabase, config.table))) {
    result.skipped = rows.length;
    result.errors = rows.length;
    result.messages.push(
      `Table ${config.table} does not exist. Skipped ${rows.length} rows.`
    );
    return result;
  }

  const [parents, existingDocuments] = await Promise.all([
    fetchAll(supabase, config.parentTable, "id"),
    fetchAll(supabase, config.table, `id,${config.parentIdColumn},file_url`),
  ]);
  const parentIds = new Set(parents.map((parent) => parent.id));
  const existingKeys = new Set(
    existingDocuments.map(
      (document) =>
        `${document[config.parentIdColumn]}::${normalized(document.file_url)}`
    )
  );
  const seenKeys = new Set();

  for (const row of rows) {
    const parentId = row[config.parentIdColumn];
    const urlKey = `${parentId}::${normalized(row.file_url)}`;
    const rowKey = duplicateKey(row, config.parentIdColumn);

    if (!parentId || !parentIds.has(parentId)) {
      result.skipped += 1;
      result.errors += 1;
      if (result.messages.length < 20) {
        result.messages.push(
          `${config.table} CSV row ${row.__row_number}: parent ${config.parentIdColumn} not found.`
        );
      }
      continue;
    }

    if (!row.file_url || !row.file_id) {
      result.skipped += 1;
      result.errors += 1;
      if (result.messages.length < 20) {
        result.messages.push(
          `${config.table} CSV row ${row.__row_number}: missing file_url or file_id.`
        );
      }
      continue;
    }

    if (existingKeys.has(urlKey) || seenKeys.has(rowKey)) {
      result.duplicates += 1;
      continue;
    }

    seenKeys.add(rowKey);
    const payload = insertPayload(row, config.insertColumns);
    const { data, error } = await supabase
      .from(config.table)
      .insert(payload)
      .select(`id,${config.parentIdColumn},file_url`)
      .single();

    if (error) {
      const message = `${error.message || ""} ${error.details || ""}`.trim();
      if (error.code === "23505" || message.toLowerCase().includes("duplicate")) {
        result.duplicates += 1;
      } else {
        result.skipped += 1;
        result.errors += 1;
        if (result.messages.length < 20) {
          result.messages.push(
            `${config.table} CSV row ${row.__row_number}: ${message || "insert failed"}`
          );
        }
      }
      continue;
    }

    result.inserted += 1;
    existingKeys.add(`${data[config.parentIdColumn]}::${normalized(data.file_url)}`);
  }

  result.finalCount = await fetchCount(supabase, config.table);
  return result;
}

async function main() {
  loadEnv();
  const supabase = adminClient();
  const results = [];

  for (const [key, config] of Object.entries(TABLES)) {
    results.push(await importTable(supabase, key, config));
  }

  console.log("Historical Google Drive document link import complete");
  for (const result of results) {
    console.log(`\n${result.table}`);
    console.log(`source rows: ${result.sourceRows}`);
    console.log(`inserted: ${result.inserted}`);
    console.log(`skipped: ${result.skipped}`);
    console.log(`duplicates: ${result.duplicates}`);
    console.log(`errors: ${result.errors}`);
    console.log(`final count: ${result.finalCount}`);
    for (const message of result.messages) {
      console.log(`- ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
