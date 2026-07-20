#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const OUT_DIR = "reports/drive-folder-backfill";
const REPORT_PATH = path.join(OUT_DIR, "backfill_report.csv");
const READY_PATH = path.join(OUT_DIR, "backfill_sql_ready.csv");
const ERRORS_PATH = path.join(OUT_DIR, "backfill_errors.csv");
const DEFAULT_INVENTORY = "import-data/drive_folder_inventory.csv";

const REQUIRED_SUBFOLDERS = {
  ra_bills_folder_id: "RA Bills",
  invoices_folder_id: "Invoices",
  debit_notes_folder_id: "Debit Notes",
  contractor_docs_folder_id: "Contractor Docs",
};

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
    Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]))
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
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

function normalizeWorkOrderNumber(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .replace(/\/+/g, "/");
}

function normalizeWorkOrderFolderName(folderName) {
  return normalizeWorkOrderNumber(
    String(folderName || "")
      .trim()
      .replace(/^\d+\s*[.)-]\s*/, "")
      .replace(/_/g, "/")
  );
}

function pick(row, names) {
  for (const name of names) {
    const key = normalizeHeader(name);
    const value = row[key];
    if (String(value || "").trim()) return String(value).trim();
  }
  return "";
}

function normalizeSubfolderName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function applyFolderRow(folders, row) {
  const woFolderName = pick(row, ["wo_folder_name", "folder_name", "drive_folder_name"]);
  const explicitWoNumber = pick(row, ["wo_number", "work_order_number"]);
  const woNumber = normalizeWorkOrderNumber(explicitWoNumber) || normalizeWorkOrderFolderName(woFolderName);
  if (!woNumber) return;

  const current = folders.get(woNumber) || {
    wo_number: woNumber,
    drive_folder_id: "",
    drive_folder_name: woFolderName,
    ra_bills_folder_id: "",
    invoices_folder_id: "",
    debit_notes_folder_id: "",
    contractor_docs_folder_id: "",
  };

  current.drive_folder_id ||= pick(row, ["drive_folder_id", "folder_id", "wo_folder_id"]);
  current.drive_folder_name ||= woFolderName;
  current.ra_bills_folder_id ||= pick(row, ["ra_bills_folder_id"]);
  current.invoices_folder_id ||= pick(row, ["invoices_folder_id"]);
  current.debit_notes_folder_id ||= pick(row, ["debit_notes_folder_id"]);
  current.contractor_docs_folder_id ||= pick(row, ["contractor_docs_folder_id"]);

  const subfolderName = normalizeSubfolderName(pick(row, ["subfolder_name", "child_folder_name"]));
  const subfolderId = pick(row, ["subfolder_id", "child_folder_id"]);
  if (subfolderName && subfolderId) {
    for (const [column, label] of Object.entries(REQUIRED_SUBFOLDERS)) {
      if (subfolderName === normalizeSubfolderName(label)) current[column] = subfolderId;
    }
  }

  folders.set(woNumber, current);
}

async function loadFolderInventory() {
  const folders = new Map();
  const inventoryPath = process.env.DRIVE_FOLDER_INVENTORY_CSV || DEFAULT_INVENTORY;

  if (fs.existsSync(inventoryPath)) {
    for (const row of parseCsv(fs.readFileSync(inventoryPath, "utf8"))) {
      applyFolderRow(folders, row);
    }
    return { folders, source: inventoryPath };
  }

  const endpoint = process.env.GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL;
  if (endpoint) {
   const response = await fetch(
  `${endpoint}?action=list_work_order_folders`
);
    const result = await response.json().catch(() => null);

    if (response.ok && result?.success && Array.isArray(result.folders)) {
      for (const row of result.folders) applyFolderRow(folders, row);
      return { folders, source: "GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL:list_work_order_folders" };
    }
  }

  throw new Error(
    `No folder inventory found. Create ${inventoryPath} with WO folder/subfolder IDs, or extend the Apps Script to support { action: "list_work_order_folders" }.`
  );
}

function missingRequiredFolders(folder) {
  return Object.keys(REQUIRED_SUBFOLDERS).filter((column) => !folder[column]);
}

async function main() {
  loadEnv();
  const admin = adminClient();
  const { folders, source } = await loadFolderInventory();

  const [workOrders, existingRows] = await Promise.all([
    fetchAll(admin, "work_orders", "id, organization_id, wo_number"),
    fetchAll(admin, "work_order_drive_folders", "work_order_id, drive_folder_id"),
  ]);

  const existingByWorkOrderId = new Set(existingRows.map((row) => row.work_order_id).filter(Boolean));
  const existingDriveFolderIds = new Set(existingRows.map((row) => row.drive_folder_id).filter(Boolean));
  const report = [];
  const ready = [];
  const errors = [];

  for (const workOrder of workOrders) {
    const woNumber = normalizeWorkOrderNumber(workOrder.wo_number);
    const folder = folders.get(woNumber);
    const base = {
      organization_id: workOrder.organization_id,
      work_order_id: workOrder.id,
      wo_number: workOrder.wo_number,
      drive_folder_id: folder?.drive_folder_id || "",
      drive_folder_name: folder?.drive_folder_name || "",
      ra_bills_folder_id: folder?.ra_bills_folder_id || "",
      invoices_folder_id: folder?.invoices_folder_id || "",
      debit_notes_folder_id: folder?.debit_notes_folder_id || "",
      contractor_docs_folder_id: folder?.contractor_docs_folder_id || "",
    };

    if (!folder) {
      const row = { ...base, status: "missing_drive_folder", reason: "No matching Drive folder inventory row" };
      report.push(row);
      errors.push(row);
      continue;
    }

    const missing = missingRequiredFolders(folder);
    if (!folder.drive_folder_id || missing.length > 0) {
      const row = {
        ...base,
        status: "missing_subfolder_ids",
        reason: `Missing ${[!folder.drive_folder_id ? "drive_folder_id" : "", ...missing].filter(Boolean).join(" | ")}`,
      };
      report.push(row);
      errors.push(row);
      continue;
    }

    if (existingByWorkOrderId.has(workOrder.id)) {
      report.push({ ...base, status: "already_mapped", reason: "work_order_id already exists in work_order_drive_folders" });
      continue;
    }

    if (existingDriveFolderIds.has(folder.drive_folder_id)) {
      report.push({ ...base, status: "duplicate_drive_folder", reason: "drive_folder_id already exists in work_order_drive_folders" });
      continue;
    }

    const row = { ...base, status: "ready", reason: "" };
    report.push(row);
    ready.push(base);
  }

  const reportHeaders = [
    "organization_id",
    "work_order_id",
    "wo_number",
    "drive_folder_id",
    "drive_folder_name",
    "ra_bills_folder_id",
    "invoices_folder_id",
    "debit_notes_folder_id",
    "contractor_docs_folder_id",
    "status",
    "reason",
  ];
  const readyHeaders = reportHeaders.slice(0, 9);

  writeCsv(REPORT_PATH, report, reportHeaders);
  writeCsv(READY_PATH, ready, readyHeaders);
  writeCsv(ERRORS_PATH, errors, reportHeaders);

  console.log(`folder inventory source: ${source}`);
  console.log(`work orders checked: ${workOrders.length}`);
  console.log(`ready rows: ${ready.length}`);
  console.log(`already mapped: ${report.filter((row) => row.status === "already_mapped").length}`);
  console.log(`missing drive folders: ${errors.filter((row) => row.status === "missing_drive_folder").length}`);
  console.log(`missing subfolder ids: ${errors.filter((row) => row.status === "missing_subfolder_ids").length}`);
  console.log(`reports written to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
