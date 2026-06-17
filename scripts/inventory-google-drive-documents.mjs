#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUT_DIR = "reports/document-inventory";
const DEFAULT_SOURCE_CANDIDATES = [
  "import-data/google-drive-export",
  "import-data/google-drive",
  "import-data/drive-export",
  "google-drive-export",
  "drive-export",
];

const REPORTS = {
  work_order: "work_order_files.csv",
  ra_bill: "ra_bill_files.csv",
  invoice: "invoice_files.csv",
  vendor: "vendor_files.csv",
};

function parseArgs(argv) {
  const args = {
    source: "",
    outDir: DEFAULT_OUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = argv[++index] || "";
    } else if (arg === "--out-dir") {
      args.outDir = argv[++index] || "";
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
  node scripts/inventory-google-drive-documents.mjs --source "path/to/exported-drive-folder"
  node scripts/inventory-google-drive-documents.mjs --source "path/to/exported-drive-folder" --out-dir reports/document-inventory

Read-only utility. Scans local files and writes CSV/JSON inventory reports only.
`);
}

function resolveSource(sourceArg) {
  if (sourceArg) {
    const resolved = path.resolve(sourceArg);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Source folder not found: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of DEFAULT_SOURCE_CANDIDATES) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  }

  throw new Error(
    `No source folder supplied. Use --source "path/to/exported-drive-folder". Tried: ${DEFAULT_SOURCE_CANDIDATES.join(", ")}`
  );
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows) {
  const headers = [
    "wo_number",
    "file_name",
    "file_extension",
    "folder_type",
    "full_relative_path",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function shouldSkipDir(name) {
  return name.startsWith(".") || name === "__MACOSX";
}

function shouldSkipFile(name) {
  return name.startsWith(".") || name === "Thumbs.db" || name === "desktop.ini";
}

function walkFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) walk(fullPath);
      } else if (entry.isFile() && !shouldSkipFile(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files;
}

function compactText(value) {
  return String(value || "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function classifyFolderType(relativePath) {
  const text = compactText(relativePath);

  if (
    /\b(invoice|invoices|tax invoice|gst invoice)\b/.test(text) ||
    /\binv\b/.test(text)
  ) {
    return "invoice";
  }

  if (
    /\b(ra bill|ra bills|running account|running account bill|rabill|ra)\b/.test(text)
  ) {
    return "ra_bill";
  }

  if (
    /\b(vendor|vendors|contractor|contractors|gstin|gst|pan|bank detail|bank details|cancelled cheque|contact)\b/.test(
      text
    )
  ) {
    return "vendor";
  }

  return "work_order";
}

function normalizeWoPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractWoNumber(relativePath) {
  const withoutExtension = relativePath.replace(/\.[^.\\/]+$/, "");
  const normalized = withoutExtension.replace(/[/\\]+/g, " ");
  const loose = normalized.replace(/[_-]+/g, " ");

  const standardMatch = loose.match(
    /\b([A-Z0-9]+)\s+(MRC|GLC|PI|MRCTS)\s+(\d+[A-Z]?)\b/i
  );
  if (standardMatch) {
    return `${standardMatch[1].toUpperCase()}/${standardMatch[2].toUpperCase()}/${standardMatch[3]}`;
  }

  const mrcWoMatch = loose.match(/\b(MRC)\s+WO\s+([A-Z0-9]+)\s+(\d+[A-Z]?)\b/i);
  if (mrcWoMatch) {
    return `${mrcWoMatch[1].toUpperCase()}/WO/${normalizeWoPart(mrcWoMatch[2])}/${mrcWoMatch[3]}`;
  }

  const compactMatch = loose.match(
    /\b([A-Z0-9]+)\s+(MRC|GLC|PI|MRCTS)\s+([A-Z0-9]+)\s+(\d+[A-Z]?)\b/i
  );
  if (compactMatch) {
    return `${compactMatch[1].toUpperCase()}/${compactMatch[2].toUpperCase()}/${compactMatch[4]}`;
  }

  return "";
}

function rowForFile(sourceDir, fullPath) {
  const relativePath = path.relative(sourceDir, fullPath);
  const fileName = path.basename(fullPath);
  const extension = path.extname(fileName).replace(/^\./, "").toLowerCase();
  const folderType = classifyFolderType(relativePath);

  return {
    wo_number: extractWoNumber(relativePath),
    file_name: fileName,
    file_extension: extension,
    folder_type: folderType,
    full_relative_path: relativePath.split(path.sep).join("/"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = resolveSource(args.source);
  const outDir = path.resolve(args.outDir || DEFAULT_OUT_DIR);
  const files = walkFiles(sourceDir);
  const grouped = {
    work_order: [],
    ra_bill: [],
    invoice: [],
    vendor: [],
  };

  for (const file of files) {
    const row = rowForFile(sourceDir, file);
    grouped[row.folder_type].push(row);
  }

  for (const [folderType, fileName] of Object.entries(REPORTS)) {
    grouped[folderType].sort((left, right) =>
      left.full_relative_path.localeCompare(right.full_relative_path)
    );
    writeCsv(path.join(outDir, fileName), grouped[folderType]);
  }

  const summary = {
    work_order_files: grouped.work_order.length,
    ra_bill_files: grouped.ra_bill.length,
    invoice_files: grouped.invoice.length,
    vendor_files: grouped.vendor.length,
    total_files: files.length,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );

  console.log("Google Drive document inventory complete");
  console.log(`source: ${sourceDir}`);
  console.log(`work_order_files: ${summary.work_order_files}`);
  console.log(`ra_bill_files: ${summary.ra_bill_files}`);
  console.log(`invoice_files: ${summary.invoice_files}`);
  console.log(`vendor_files: ${summary.vendor_files}`);
  console.log(`total_files: ${summary.total_files}`);
  console.log(`reports: ${outDir}`);
}

main();
