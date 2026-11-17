import assert from "node:assert/strict";
import fs from "node:fs";

const status = fs.readFileSync("app/api/labour/workers/_status.ts", "utf8");
const bulk = fs.readFileSync("app/api/labour/workers/bulk-status/route.ts", "utf8");
const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const attendance = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const atomic = fs.readFileSync("supabase/migrations/202609250005_labour_worker_inactivation_atomic.sql", "utf8");
const reactivation = fs.readFileSync("supabase/migrations/202611020001_labour_reactivation_new_deployment.sql", "utf8");

assert.match(status, /rpc\("inactivate_labour_worker_atomic"/);
assert.match(status, /p_worker_id: input\.workerId/);
assert.match(status, /p_organization_id: worker\.organization_id/);
assert.match(status, /p_effective_date: effectiveDate/);
assert.match(status, /p_actor_id: access\.auth\.user\.id/);
assert.match(status, /source: input\.source/);
assert.doesNotMatch(status, /source:\s*["']migration["']/);
assert.match(atomic, /for update/);
assert.match(atomic, /update public\.labour_deployments/);
assert.match(atomic, /status = 'ended'/);
assert.match(atomic, /effective_to = greatest\(coalesce\(effective_from, p_effective_date\), p_effective_date - 1\)/, "Forward-only inactivation must close the current deployment before the inactive effective date");
assert.match(status, /effective_date: effectiveDate/);
assert.match(status, /reason: input\.reason/);
assert.match(status, /closed_deployments: result\?\.closed_deployments/);
assert.match(atomic, /status = 'inactive'/);
assert.doesNotMatch(atomic, /date_of_exit/);
assert.match(bulk, /applyInactiveWorkerStatusUpdate/);
const deployments = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
assert.match(deployments, /rpcName = isReactivation \? "reactivate_labour_deployment"/);
assert.match(deployments, /\.eq\("organization_id", worker\.organization_id\)/);
assert.match(reactivation, /update public\.labour_deployments[\s\S]+status = 'ended'/);
assert.match(reactivation, /insert into public\.labour_deployments/);
assert.match(shared, /worker\.status !== "active"/);
assert.match(shared, /inactiveEffectiveDates/);
assert.match(shared, /input\.attendanceDate >= inactiveEffectiveDate/);
assert.match(attendance, /worker is not eligible for the selected Site\/date\/contractor/);

console.log("Labour forward-only inactivation/deployment contract tests passed.");
