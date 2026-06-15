#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ROLE = "Main Contractor";

function parseArgs(argv) {
  const args = {
    source: "",
    apply: false,
    out: "",
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--source") {
      args.source = argv[++i] || "";
    } else if (arg === "--out") {
      args.out = argv[++i] || "";
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i] || 0);
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
  node scripts/link-work-order-vendors.mjs --source path/to/mapping.csv
  node scripts/link-work-order-vendors.mjs --source path/to/mapping.csv --out dry-run.json
  node scripts/link-work-order-vendors.mjs --source path/to/mapping.csv --apply

Source columns accepted:
  wo_number, work_order_number, wo_no
  vendor_name, contractor_name, contractor, vendor
  pan, vendor_pan
  gstin, gst, vendor_gstin
  vendor_role, role, contractor_role

Dry-run is the default. --apply inserts only rows with status=ready.
`);
}

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
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
  return rows.slice(1).map((cells) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = (cells[index] || "").trim();
    });
    return object;
  });
}

function loadSourceRows(sourcePath) {
  if (!sourcePath) {
    throw new Error("--source is required. Provide a CSV or JSON source mapping file.");
  }

  const absolutePath = path.resolve(sourcePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Source file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const text = fs.readFileSync(absolutePath, "utf8");

  if (ext === ".csv" || ext === ".tsv") {
    return parseCsv(ext === ".tsv" ? text.replace(/\t/g, ",") : text);
  }

  if (ext === ".json") {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error("JSON source must be an array of mapping rows.");
    }
    return data.map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeHeader(key)] = String(value || "").trim();
      }
      return normalized;
    });
  }

  throw new Error(
    "Unsupported source format. Export Excel to CSV first, or provide JSON."
  );
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstValue(row, keys) {
  for (const key of keys) {
    const normalizedKey = normalizeHeader(key);
    if (row[normalizedKey]) return String(row[normalizedKey]).trim();
  }
  return "";
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

function normalizeTaxId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeWoNumber(value) {
  return String(value || "").trim();
}

function sourceIdentity(row) {
  const woNumber = normalizeWoNumber(
    firstValue(row, ["wo_number", "work_order_number", "wo_no", "work_order_no"])
  );
  const vendorName = firstValue(row, [
    "vendor_name",
    "contractor_name",
    "contractor",
    "vendor",
  ]);
  const pan = normalizeTaxId(firstValue(row, ["pan", "vendor_pan"]));
  const gstin = normalizeTaxId(firstValue(row, ["gstin", "gst", "vendor_gstin"]));
  const vendorRole =
    firstValue(row, ["vendor_role", "role", "contractor_role"]) || DEFAULT_ROLE;

  return {
    wo_number: woNumber,
    vendor_name: vendorName,
    normalized_vendor_name: normalizeName(vendorName),
    pan,
    gstin,
    vendor_role: vendorRole,
  };
}

function addToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
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

function buildVendorIndexes(vendors) {
  const byPan = new Map();
  const byGstin = new Map();
  const byName = new Map();

  for (const vendor of vendors) {
    addToMap(byPan, normalizeTaxId(vendor.pan), vendor);
    addToMap(byGstin, normalizeTaxId(vendor.gstin), vendor);
    addToMap(byName, normalizeName(vendor.vendor_name), vendor);
  }

  return { byPan, byGstin, byName };
}

function findVendorMatch(source, indexes) {
  const attempts = [
    ["PAN", source.pan, indexes.byPan],
    ["GSTIN", source.gstin, indexes.byGstin],
    ["exact normalized name", source.normalized_vendor_name, indexes.byName],
  ];

  for (const [method, key, map] of attempts) {
    if (!key) continue;
    const matches = map.get(key) || [];
    if (matches.length === 1) {
      return { status: "ready", method, vendor: matches[0] };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        method,
        matches,
        reason: `Multiple vendors match ${method}.`,
      };
    }
  }

  return {
    status: "unmatched",
    method: "",
    vendor: null,
    reason: "Source vendor does not exist in vendors by PAN, GSTIN, or exact normalized name.",
  };
}

function distinctSourceSignature(source) {
  return [
    source.vendor_name,
    source.pan,
    source.gstin,
    source.vendor_role,
  ].join("|");
}

function buildResults({ workOrders, links, sourceRows, vendors }) {
  const linkByWorkOrderId = new Map();
  for (const link of links) {
    if (!linkByWorkOrderId.has(link.work_order_id)) {
      linkByWorkOrderId.set(link.work_order_id, []);
    }
    linkByWorkOrderId.get(link.work_order_id).push(link);
  }

  const sourceByWo = new Map();
  const invalidSourceRows = [];

  for (const rawRow of sourceRows) {
    const source = sourceIdentity(rawRow);
    if (!source.wo_number) {
      invalidSourceRows.push({
        source,
        reason: "Source row is missing WO number.",
      });
      continue;
    }
    if (!source.vendor_name && !source.pan && !source.gstin) {
      invalidSourceRows.push({
        source,
        reason: "Source row has no vendor name, PAN, or GSTIN.",
      });
      continue;
    }
    if (!sourceByWo.has(source.wo_number)) sourceByWo.set(source.wo_number, []);
    sourceByWo.get(source.wo_number).push(source);
  }

  const indexes = buildVendorIndexes(vendors);
  const results = [];

  for (const workOrder of workOrders) {
    const existingLinks = linkByWorkOrderId.get(workOrder.id) || [];
    const companyName = workOrder.companies?.company_name || "";
    const siteName = workOrder.sites?.site_name || "";

    if (existingLinks.length > 0) {
      results.push({
        wo_number: workOrder.wo_number,
        work_order_id: workOrder.id,
        company: companyName,
        site: siteName,
        source_vendor_name: "",
        matched_vendor_name: "",
        matched_vendor_id: "",
        vendor_role: "",
        match_method: "",
        status: "already_linked",
        reason: "Work Order already has at least one vendor link.",
      });
      continue;
    }

    const sourceMatches = sourceByWo.get(workOrder.wo_number) || [];
    if (sourceMatches.length === 0) {
      results.push({
        wo_number: workOrder.wo_number,
        work_order_id: workOrder.id,
        company: companyName,
        site: siteName,
        source_vendor_name: "",
        matched_vendor_name: "",
        matched_vendor_id: "",
        vendor_role: "",
        match_method: "",
        status: "unmatched",
        reason: "No source row for exact WO number.",
      });
      continue;
    }

    const distinctSignatures = new Set(sourceMatches.map(distinctSourceSignature));
    if (distinctSignatures.size > 1) {
      results.push({
        wo_number: workOrder.wo_number,
        work_order_id: workOrder.id,
        company: companyName,
        site: siteName,
        source_vendor_name: sourceMatches.map((row) => row.vendor_name).join("; "),
        matched_vendor_name: "",
        matched_vendor_id: "",
        vendor_role: "",
        match_method: "",
        status: "ambiguous",
        reason: "Multiple source rows for same WO have different vendor identities.",
      });
      continue;
    }

    const source = sourceMatches[0];
    const vendorMatch = findVendorMatch(source, indexes);

    if (vendorMatch.status === "ready") {
      results.push({
        wo_number: workOrder.wo_number,
        work_order_id: workOrder.id,
        company: companyName,
        site: siteName,
        source_vendor_name: source.vendor_name,
        matched_vendor_name: vendorMatch.vendor.vendor_name,
        matched_vendor_id: vendorMatch.vendor.id,
        vendor_role: source.vendor_role || DEFAULT_ROLE,
        match_method: vendorMatch.method,
        status: "ready",
        reason: "Exact WO and vendor identity match.",
      });
    } else {
      results.push({
        wo_number: workOrder.wo_number,
        work_order_id: workOrder.id,
        company: companyName,
        site: siteName,
        source_vendor_name: source.vendor_name,
        matched_vendor_name: "",
        matched_vendor_id: "",
        vendor_role: source.vendor_role || DEFAULT_ROLE,
        match_method: vendorMatch.method,
        status: vendorMatch.status,
        reason: vendorMatch.reason,
      });
    }
  }

  for (const invalid of invalidSourceRows) {
    results.push({
      wo_number: invalid.source.wo_number,
      work_order_id: "",
      company: "",
      site: "",
      source_vendor_name: invalid.source.vendor_name,
      matched_vendor_name: "",
      matched_vendor_id: "",
      vendor_role: invalid.source.vendor_role || "",
      match_method: "",
      status: "invalid_source",
      reason: invalid.reason,
    });
  }

  return results;
}

function countByStatus(results) {
  const counts = {
    total: results.length,
    total_missing: results.filter(
      (row) => row.work_order_id && row.status !== "already_linked"
    ).length,
    ready: 0,
    unmatched: 0,
    ambiguous: 0,
    already_linked: 0,
    invalid_source: 0,
  };

  for (const result of results) {
    if (Object.prototype.hasOwnProperty.call(counts, result.status)) {
      counts[result.status] += 1;
    }
  }

  return counts;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const headers = [
    "wo_number",
    "work_order_id",
    "company",
    "site",
    "source_vendor_name",
    "matched_vendor_name",
    "matched_vendor_id",
    "vendor_role",
    "match_method",
    "status",
    "reason",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

async function applyReadyRows(supabase, results) {
  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (const row of results.filter((result) => result.status === "ready")) {
    const { data: existing, error: existingError } = await supabase
      .from("work_order_vendors")
      .select("id")
      .eq("work_order_id", row.work_order_id)
      .limit(1);

    if (existingError) {
      errors.push({ wo_number: row.wo_number, error: existingError.message });
      continue;
    }

    if ((existing || []).length > 0) {
      skipped += 1;
      continue;
    }

    const { error } = await supabase.from("work_order_vendors").insert({
      organization_id: row.organization_id,
      work_order_id: row.work_order_id,
      vendor_id: row.matched_vendor_id,
      vendor_role: row.vendor_role,
      is_primary: true,
    });

    if (error) {
      errors.push({ wo_number: row.wo_number, error: error.message });
    } else {
      inserted += 1;
    }
  }

  return { inserted, skipped, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const supabase = adminClient();
  const sourceRows = loadSourceRows(args.source);

  const [workOrders, vendors, links] = await Promise.all([
    fetchAll(
      supabase,
      "work_orders",
      "id, organization_id, wo_number, companies(company_name, company_code), sites(site_name, site_code)"
    ),
    fetchAll(supabase, "vendors", "id, vendor_name, pan, gstin, status"),
    fetchAll(supabase, "work_order_vendors", "id, work_order_id, vendor_id, vendor_role"),
  ]);

  const results = buildResults({ workOrders, links, sourceRows, vendors }).map(
    (row) => {
      const workOrder = workOrders.find((item) => item.id === row.work_order_id);
      return {
        ...row,
        organization_id: workOrder?.organization_id || "",
      };
    }
  );
  const counts = countByStatus(results);
  const printableResults = args.limit > 0 ? results.slice(0, args.limit) : results;

  console.log("Work Order vendor link dry-run");
  console.log(JSON.stringify(counts, null, 2));
  console.table(
    printableResults.map(({ organization_id, ...row }) => row)
  );

  if (args.out) {
    const outPath = path.resolve(args.out);
    const ext = path.extname(outPath).toLowerCase();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (ext === ".csv") {
      fs.writeFileSync(outPath, toCsv(results));
    } else {
      fs.writeFileSync(outPath, JSON.stringify({ counts, results }, null, 2));
    }
    console.log(`Wrote dry-run output to ${outPath}`);
  }

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to insert status=ready rows.");
    return;
  }

  const applyResult = await applyReadyRows(supabase, results);
  console.log("Apply result");
  console.log(JSON.stringify(applyResult, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
