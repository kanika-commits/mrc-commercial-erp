#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE = "reports/document-audit/misclassified_ra_documents.csv";

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

function isAllowedRaFileName(fileName) {
  const text = String(fileName || "");
  const hasWorkOrderMarker =
    /\bWO\b/i.test(text) || /\bWork\s*Order\b/i.test(text);
  const hasRaMarker =
    /\bRA\s*Bill\b/i.test(text) ||
    /R\.?\s*A\.?\s*[-_\s]*0*\d+/i.test(text) ||
    /\bR\.?\s*A\.?\b/i.test(text);

  return hasRaMarker && !hasWorkOrderMarker;
}

async function main() {
  loadEnv();
  const sourcePath = path.resolve(SOURCE);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source CSV not found: ${sourcePath}`);
  }

  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const supabase = adminClient();

  let inserted = 0;
  let deleted = 0;
  let skipped = 0;
  let duplicates = 0;
  let errors = 0;
  const messages = [];

  for (const row of rows) {
    const workOrderId = row.work_order_id;
    const raBillId = row.matched_ra_bill_id;
    const fileName = row.file_name;
    const fileUrl = row.file_url;

    if (!workOrderId || !raBillId || !fileUrl || !isAllowedRaFileName(fileName)) {
      skipped += 1;
      messages.push(`Row ${row.__row_number}: skipped by guard checks.`);
      continue;
    }

    const { data: originalDocs, error: originalError } = await supabase
      .from("work_order_documents")
      .select("id, organization_id, work_order_id, file_name, file_url, uploaded_at")
      .eq("work_order_id", workOrderId)
      .eq("file_url", fileUrl);

    if (originalError) {
      errors += 1;
      messages.push(`Row ${row.__row_number}: ${originalError.message}`);
      continue;
    }

    if (!originalDocs || originalDocs.length !== 1) {
      skipped += 1;
      messages.push(
        `Row ${row.__row_number}: expected 1 source work_order_documents row, found ${originalDocs?.length || 0}.`
      );
      continue;
    }

    const sourceDoc = originalDocs[0];

    const { data: raBill, error: raBillError } = await supabase
      .from("ra_bills")
      .select("id, organization_id")
      .eq("id", raBillId)
      .maybeSingle();

    if (raBillError || !raBill) {
      errors += 1;
      messages.push(
        `Row ${row.__row_number}: matched RA Bill not found. ${raBillError?.message || ""}`
      );
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("ra_bill_documents")
      .select("id")
      .eq("ra_bill_id", raBillId)
      .eq("file_url", fileUrl)
      .limit(1);

    if (existingError) {
      errors += 1;
      messages.push(`Row ${row.__row_number}: ${existingError.message}`);
      continue;
    }

    if (existing && existing.length > 0) {
      duplicates += 1;
    } else {
      const { error: insertError } = await supabase
        .from("ra_bill_documents")
        .insert({
          organization_id: raBill.organization_id || sourceDoc.organization_id,
          ra_bill_id: raBillId,
          file_name: sourceDoc.file_name,
          file_url: sourceDoc.file_url,
          uploaded_at: sourceDoc.uploaded_at || new Date().toISOString(),
        });

      if (insertError) {
        errors += 1;
        messages.push(`Row ${row.__row_number}: ${insertError.message}`);
        continue;
      }

      inserted += 1;
    }

    const { error: deleteError } = await supabase
      .from("work_order_documents")
      .delete()
      .eq("id", sourceDoc.id);

    if (deleteError) {
      errors += 1;
      messages.push(`Row ${row.__row_number}: delete failed: ${deleteError.message}`);
      continue;
    }

    deleted += 1;
  }

  console.log("Misclassified RA document repair complete");
  console.log(`source rows: ${rows.length}`);
  console.log(`inserted: ${inserted}`);
  console.log(`deleted: ${deleted}`);
  console.log(`skipped: ${skipped}`);
  console.log(`duplicates: ${duplicates}`);
  console.log(`errors: ${errors}`);
  for (const message of messages.slice(0, 20)) {
    console.log(`- ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
