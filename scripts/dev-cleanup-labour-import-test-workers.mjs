import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const execute = process.argv.includes("--execute");

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

function supabaseAdmin() {
  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

async function selectRows(admin, table, columns, column, values) {
  if (!values.length) return [];
  const { data, error } = await admin.from(table).select(columns).in(column, values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function countRows(admin, table, column, values, build = (query) => query) {
  if (!values.length) return 0;
  const query = build(admin.from(table).select("id", { count: "exact", head: true }).in(column, values));
  const { count, error } = await query;
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return 0;
    throw new Error(`${table}: ${error.message}`);
  }
  return Number(count || 0);
}

async function deleteRows(admin, table, column, values, build = (query) => query) {
  if (!values.length) return 0;
  const before = await countRows(admin, table, column, values, build);
  if (!execute || before === 0) return before;
  const { error } = await build(admin.from(table).delete().in(column, values));
  if (error) throw new Error(`${table}: ${error.message}`);
  return before;
}

async function updateRows(admin, table, patch, column, values) {
  if (!values.length || !execute) return 0;
  const before = await countRows(admin, table, column, values);
  if (!before) return 0;
  const { error } = await admin.from(table).update(patch).in(column, values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return before;
}

async function deleteStorageObjects(admin, documents) {
  const byBucket = new Map();
  for (const doc of documents) {
    if (doc.storage_provider !== "supabase" || !doc.storage_bucket || !doc.storage_key) continue;
    byBucket.set(doc.storage_bucket, [...(byBucket.get(doc.storage_bucket) || []), doc.storage_key]);
  }
  const result = {};
  for (const [bucket, keys] of byBucket.entries()) {
    result[bucket] = keys.length;
    if (!execute || !keys.length) continue;
    const { error } = await admin.storage.from(bucket).remove(keys);
    if (error) throw new Error(`storage:${bucket}: ${error.message}`);
  }
  return result;
}

async function main() {
  if (execute && !["development", "test", "local"].includes(String(process.env.NODE_ENV || "development").toLowerCase())) {
    throw new Error("Refusing to execute outside NODE_ENV=development/test/local.");
  }

  const admin = supabaseAdmin();
  const { data: importRows, error: importRowsError } = await admin
    .from("labour_import_rows")
    .select("id, batch_id, created_labour_worker_id, matched_labour_worker_id, execution_status, source_row_number")
    .not("created_labour_worker_id", "is", null);
  if (importRowsError) throw importRowsError;

  const workerIds = Array.from(new Set((importRows || []).map((row) => row.created_labour_worker_id).filter(Boolean)));
  const batchIds = Array.from(new Set((importRows || []).map((row) => row.batch_id).filter(Boolean)));

  const workers = await selectRows(admin, "labour_workers", "id, labour_code, worker_name, status", "id", workerIds);
  const liveWorkerIds = workers.map((worker) => worker.id);
  const documents = await selectRows(admin, "labour_documents", "id, labour_worker_id, storage_provider, storage_bucket, storage_key", "labour_worker_id", liveWorkerIds);
  const advances = await selectRows(admin, "labour_advances", "id", "labour_worker_id", liveWorkerIds);
  const advanceIds = advances.map((advance) => advance.id);

  const operationalCounts = {
    labour_attendance: await countRows(admin, "labour_attendance", "labour_worker_id", liveWorkerIds),
    labour_site_ins: await countRows(admin, "labour_site_ins", "labour_worker_id", liveWorkerIds),
    labour_site_in_engineer_assignments: await countRows(admin, "labour_site_in_engineer_assignments", "labour_worker_id", liveWorkerIds),
    labour_work_group_members: await countRows(admin, "labour_work_group_members", "labour_worker_id", liveWorkerIds),
    labour_wage_rates: await countRows(admin, "labour_wage_rates", "labour_worker_id", liveWorkerIds),
    labour_wage_lines: await countRows(admin, "labour_wage_lines", "labour_worker_id", liveWorkerIds),
    labour_advances: advances.length,
    labour_advance_recoveries: await countRows(admin, "labour_advance_recoveries", "advance_id", advanceIds),
    labour_overtime_requests: await countRows(admin, "labour_overtime_requests", "labour_worker_id", liveWorkerIds),
  };

  const operationalTotal = Object.values(operationalCounts).reduce((sum, count) => sum + count, 0);
  const summary = {
    mode: execute ? "execute" : "dry-run",
    imported_worker_count: liveWorkerIds.length,
    import_batch_count: batchIds.length,
    import_row_count: importRows?.length || 0,
    workers: workers.map((worker) => ({ labour_code: worker.labour_code, worker_name: worker.worker_name, status: worker.status })),
    operational_counts: operationalCounts,
  };

  if (operationalTotal > 0) {
    console.log(JSON.stringify({ ...summary, aborted: true, reason: "Operational Labour records exist. Cleanup is limited to registration/import-only workers." }, null, 2));
    process.exit(1);
  }

  const storageDeleted = await deleteStorageObjects(admin, documents);
  const deleted = {
    labour_import_batches: await deleteRows(admin, "labour_import_batches", "id", batchIds),
    labour_documents_replacement_links_cleared: await updateRows(admin, "labour_documents", { replaced_by_document_id: null }, "labour_worker_id", liveWorkerIds),
    labour_documents: await deleteRows(admin, "labour_documents", "labour_worker_id", liveWorkerIds),
    labour_worker_rate_overrides: await deleteRows(admin, "labour_worker_rate_overrides", "labour_worker_id", liveWorkerIds),
    labour_deployments: await deleteRows(admin, "labour_deployments", "labour_worker_id", liveWorkerIds),
    labour_workers: await deleteRows(admin, "labour_workers", "id", liveWorkerIds),
  };

  console.log(JSON.stringify({
    ...summary,
    deletion_order: [
      "Supabase Storage objects from labour_documents",
      "labour_import_batches (cascades labour_import_rows)",
      "labour_documents replacement links",
      "labour_documents",
      "labour_worker_rate_overrides",
      "labour_deployments",
      "labour_workers",
    ],
    storage_objects: storageDeleted,
    deleted,
    execute_hint: execute ? "Cleanup executed." : "Dry-run only. Re-run with --execute to delete.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
