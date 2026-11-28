import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202611270001_labour_platform_owner_manage_work_atomic.sql", "utf8");

assert.match(page, /roleCodes\.includes\("platform_owner"\)/, "UI identifies Platform Owner explicitly");
assert.match(page, /This worker is inactive\. Saving will reactivate/, "inactive warning is visible");
assert.match(page, /window\.confirm\("This worker is inactive\./, "reactivation requires explicit confirmation");
assert.match(page, /include_rate_change: includeRateChange/, "combined assignment/rate flag is sent");
assert.match(page, /if \(!isPlatformOwner\) return setDeploymentError\("Assignment and rate changes cannot be saved together/, "normal users keep the combined-change restriction");
assert.match(route, /roleCodes\.includes\("platform_owner"\)/, "server identifies Platform Owner explicitly");
assert.match(route, /Only a Platform Owner can reactivate an inactive labourer/, "server rejects non-Platform-Owner reactivation");
assert.match(route, /Only a Platform Owner can save assignment and rate changes together/, "server rejects non-Platform-Owner combined changes");
assert.match(route, /rpc\("manage_labour_work_atomic"/, "combined/reactivation path uses one atomic RPC");
assert.match(migration, /create or replace function public\.manage_labour_work_atomic/, "forward migration defines the atomic Labour path");
assert.match(migration, /effective_from = v_effective_from/, "same-date deployment rows are found for correction/reuse");
assert.match(migration, /Platform Owner corrected\/reused a same-date deployment/, "deployment correction is audited");
assert.match(migration, /Platform Owner corrected\/reused a same-date wage rate/, "wage correction is audited");
assert.match(migration, /public\.reactivate_labour_deployment\(/, "new-date reactivation preserves the existing RPC rules");
assert.match(migration, /public\.transfer_labour_deployment\(/, "new-date assignment changes preserve the existing RPC rules");
assert.match(migration, /public\.update_labour_wage_rate_atomic\(/, "new wage rows use the atomic wage RPC");
assert.match(migration, /revoke all on function public\.manage_labour_work_atomic/, "function is not executable by browser roles");
assert.match(migration, /grant execute on function public\.manage_labour_work_atomic[\s\S]*to service_role/, "only service_role receives execution");
assert.doesNotMatch(migration, /delete from public\.labour_(deployments|wage_rates)/, "correction path never deletes history");

console.log("labour platform-owner manage-work checks passed");
