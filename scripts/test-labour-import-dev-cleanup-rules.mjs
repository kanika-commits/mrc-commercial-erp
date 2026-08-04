import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./dev-cleanup-labour-import-test-workers.mjs", import.meta.url), "utf8");

assert.match(source, /const execute = process\.argv\.includes\("--execute"\)/, "cleanup must default to dry-run and require --execute");
assert.match(source, /Refusing to execute outside NODE_ENV=development\/test\/local/, "cleanup must be development-only when executing");
assert.match(source, /\.from\("labour_import_rows"\)[\s\S]+\.not\("created_labour_worker_id", "is", null\)/, "cleanup targets Labour Import-created workers only");
assert.match(source, /operational_counts/, "cleanup must audit operational references before deleting");
assert.match(source, /Operational Labour records exist/, "cleanup must abort when operational Labour records are present");
assert.match(source, /labour_attendance[\s\S]+labour_site_ins[\s\S]+labour_site_in_engineer_assignments[\s\S]+labour_work_group_members[\s\S]+labour_wage_rates[\s\S]+labour_wage_lines[\s\S]+labour_advances[\s\S]+labour_advance_recoveries[\s\S]+labour_overtime_requests/, "cleanup must check all worker-level operational tables");
assert.match(source, /admin\.storage\.from\(bucket\)\.remove\(keys\)/, "cleanup must remove imported Supabase Storage objects before document rows");
assert.match(source, /labour_import_batches[\s\S]+labour_documents[\s\S]+labour_worker_rate_overrides[\s\S]+labour_deployments[\s\S]+labour_workers/, "cleanup must delete in child/setup-to-worker order");
assert.doesNotMatch(source, /\.rpc\(|\.sql\(|executeSql|raw SQL/i, "cleanup must not execute raw SQL");
assert.doesNotMatch(source, /erp_audit_logs.*delete/, "cleanup must preserve audit logs");

console.log("Labour import development cleanup rules passed.");
