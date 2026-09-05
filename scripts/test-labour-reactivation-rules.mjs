import assert from "node:assert/strict";
import fs from "node:fs";

const detailPage = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const deploymentApi = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
const reactivationRpc = fs.readFileSync("supabase/migrations/202608070002_add_labour_reactivation_rpc.sql", "utf8");

assert.match(detailPage, /Reactivate Labour/);
assert.match(detailPage, /Previous Assignment/);
assert.match(detailPage, /Previous Assignment[\s\S]+previousDeployment\?\.companies/);
assert.match(detailPage, /Contractor \*<select/);
assert.match(detailPage, /deploymentForm\.contractor_profile_id/);
assert.match(detailPage, /lookups\.contractors\.map/);
assert.match(deploymentApi, /const isReactivation = worker\.status === "inactive"/);
assert.match(deploymentApi, /const contractorProfileId = text\(payload\.contractor_profile_id\) \|\| worker\.current_contractor_profile_id/);
assert.match(deploymentApi, /reactivate_labour_deployment/);
assert.match(deploymentApi, /p_contractor_profile_id: insertPayload\.contractor_profile_id/);
assert.match(deploymentApi, /p_effective_from: effectiveFrom/);
assert.match(reactivationRpc, /where id = p_worker_id[\s\S]+status = 'inactive'[\s\S]+for update/);
assert.match(reactivationRpc, /insert into public\.labour_deployments/);
assert.match(reactivationRpc, /update public\.labour_workers[\s\S]+current_contractor_profile_id = p_contractor_profile_id/);
assert.doesNotMatch(reactivationRpc, /update public\.labour_deployments/);
assert.match(detailPage, /change_deployment/);
console.log("Labour reactivation rules: PASS");
