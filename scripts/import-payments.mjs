#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE = "reports/payments-import/payments_sql_ready.csv";

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
  node scripts/import-payments.mjs
  node scripts/import-payments.mjs --source reports/payments-import/payments_sql_ready.csv

Imports Payments only. Documents are not imported and existing rows are never modified.
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

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function numberValue(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function activeStatus(value) {
  return ["", "active", "enabled", "open"].includes(normalized(value));
}

async function idExists(supabase, table, id) {
  if (!id) return false;
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
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

async function fetchPaymentCount(supabase) {
  const { count, error } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

function duplicateMessage(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${
    error?.constraint || ""
  }`.toLowerCase();

  if (error?.code === "23505" || message.includes("payments_unique_number_per_org")) {
    return "Duplicate payment number.";
  }

  if (
    error?.code === "23505" ||
    message.includes("payments_unique_utr_per_org_when_present")
  ) {
    return "Duplicate UTR number.";
  }

  return error?.message || "Insert failed.";
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
  const [workOrders, vendors, links, invoices, bankAccounts, payments] =
    await Promise.all([
      fetchAll(supabase, "work_orders", "id"),
      fetchAll(supabase, "vendors", "id"),
      fetchAll(supabase, "work_order_vendors", "work_order_id,vendor_id"),
      fetchAll(supabase, "invoices", "id"),
      fetchAll(supabase, "company_bank_accounts", "id,status"),
      fetchAll(supabase, "payments", "id,organization_id,payment_number,utr_number"),
    ]);

  const workOrderIds = new Set(workOrders.map((row) => row.id));
  const vendorIds = new Set(vendors.map((row) => row.id));
  const linkKeys = new Set(
    links.map((row) => `${row.work_order_id}:${row.vendor_id}`)
  );
  const invoiceIds = new Set(invoices.map((row) => row.id));
  const activeBankAccountIds = new Set(
    bankAccounts
      .filter((row) => activeStatus(row.status))
      .map((row) => row.id)
  );
  const existingPaymentKeys = new Set(
    payments
      .filter((row) => row.organization_id && row.payment_number)
      .map((row) => `${row.organization_id}:${normalized(row.payment_number)}`)
  );
  const existingUtrKeys = new Set(
    payments
      .filter((row) => row.organization_id && row.utr_number)
      .map((row) => `${row.organization_id}:${normalized(row.utr_number)}`)
  );
  const seenPaymentKeys = new Set();
  const seenUtrKeys = new Set();
  const errors = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const organizationId = row.organization_id;
    const workOrderId = row.work_order_id;
    const vendorId = row.vendor_id;
    const invoiceId = row.invoice_id;
    const paymentNumber = row.payment_number;
    const utrNumber = row.utr_number;
    const bankAccountId = row.company_bank_account_id;
    const paymentKey = `${organizationId}:${normalized(paymentNumber)}`;
    const utrKey = `${organizationId}:${normalized(utrNumber)}`;

    if (!organizationId || !workOrderId || !vendorId || !paymentNumber) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        payment_number: paymentNumber,
        reason:
          "Missing organization_id, work_order_id, vendor_id, or payment_number.",
      });
      continue;
    }

    if (seenPaymentKeys.has(paymentKey) || (utrNumber && seenUtrKeys.has(utrKey))) {
      duplicates += 1;
      continue;
    }
    seenPaymentKeys.add(paymentKey);
    if (utrNumber) seenUtrKeys.add(utrKey);

    const workOrderExists = workOrderIds.has(workOrderId);
    const vendorExists = vendorIds.has(vendorId);
    const linked = linkKeys.has(`${workOrderId}:${vendorId}`);
    const invoiceExists = invoiceId ? invoiceIds.has(invoiceId) : true;
    const bankExists = activeBankAccountIds.has(bankAccountId);

    if (!workOrderExists || !vendorExists || !linked || !invoiceExists || !bankExists) {
      skipped += 1;
      errors.push({
        row: row.__row_number,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        invoice_id: invoiceId,
        company_bank_account_id: bankAccountId,
        payment_number: paymentNumber,
        reason: [
          workOrderExists ? "" : "work_order_id not found",
          vendorExists ? "" : "vendor_id not found",
          linked ? "" : "vendor is not linked to Work Order",
          invoiceExists ? "" : "invoice_id not found",
          bankExists ? "" : "company_bank_account_id not found or inactive",
        ]
          .filter(Boolean)
          .join("; "),
      });
      continue;
    }

    if (existingPaymentKeys.has(paymentKey) || (utrNumber && existingUtrKeys.has(utrKey))) {
      duplicates += 1;
      continue;
    }

    const insertRow = {
      organization_id: organizationId,
      work_order_id: workOrderId,
      vendor_id: vendorId,
      invoice_id: invoiceId || null,
      payment_number: paymentNumber,
      payment_date: row.payment_date,
      total_payment: numberValue(row.total_payment),
      tds_amount: numberValue(row.tds_amount),
      transferred_amount: numberValue(row.transferred_amount),
      payment_amount: numberValue(row.transferred_amount),
      payment_type: row.payment_type || "Work Order",
      payment_mode: row.payment_mode || "Bank Transfer",
      utr_number: utrNumber || null,
      reference_number: row.reference_number || null,
      company_bank_account_id: bankAccountId,
      status: row.status || "Completed",
      remarks: row.remarks || null,
    };

    const { data, error } = await supabase
      .from("payments")
      .insert(insertRow)
      .select("id, payment_number, utr_number")
      .single();

    if (error) {
      const message = duplicateMessage(error);
      if (message.toLowerCase().includes("duplicate")) {
        duplicates += 1;
      } else {
        skipped += 1;
        errors.push({
          row: row.__row_number,
          payment_number: paymentNumber,
          reason: message,
        });
      }
      continue;
    }

    inserted += 1;
    existingPaymentKeys.add(
      `${organizationId}:${normalized(data.payment_number)}`
    );
    if (data.utr_number) {
      existingUtrKeys.add(`${organizationId}:${normalized(data.utr_number)}`);
    }
  }

  const finalCount = await fetchPaymentCount(supabase);

  console.log("Payments import complete");
  console.log(`source rows: ${rows.length}`);
  console.log(`inserted: ${inserted}`);
  console.log(`skipped: ${skipped}`);
  console.log(`duplicates: ${duplicates}`);
  console.log(`errors: ${errors.length}`);
  console.log(`final payment count: ${finalCount}`);

  if (errors.length > 0) {
    console.log("First 20 errors:");
    console.log(JSON.stringify(errors.slice(0, 20), null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
