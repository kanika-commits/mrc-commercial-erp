import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/labour/workers/[id]/deployment-date-correction/route.ts", "utf8");
const page = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const transfer = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");

assert.match(route, /platform_owner.*super_admin|super_admin.*platform_owner/, "Correction is restricted to the existing global roles");
assert.match(route, /return jsonError\([^\n]+, 403\)/, "Ordinary correction requests are rejected server-side");
assert.match(route, /reason\.length < 10/, "Correction reason is mandatory and meaningful");
assert.match(route, /deployment\.effective_from === correctedDate/, "Same-date correction is rejected");
assert.match(route, /previous deployment boundary/);
assert.match(route, /next deployment boundary/);
assert.match(route, /attendanceCount.*snapshotCount/, "Downstream attendance and snapshot references block correction");
assert.match(route, /effective_from: correctedDate/);
assert.doesNotMatch(route, /company_id: corrected|site_id: corrected|effective_to: corrected|status: corrected|wage_rate: corrected/, "Only effective_from is corrected");
assert.match(route, /oldValues: \{ effective_from: deployment\.effective_from, reason \}/);
assert.match(route, /newValues: \{ effective_from: correctedDate, reason \}/);
assert.match(page, /Correct Deployment Date/);
assert.match(page, /roleCodes\.includes\("super_admin"\)/);
assert.match(transfer, /New deployment must start after the current deployment start date\./, "Normal transfer chronology remains unchanged");
assert.match(transfer, /transfer_labour_deployment/);
assert.doesNotMatch(route, /labour_attendance.*update|submission_version.*update|reconstruct/, "Correction does not mutate attendance or snapshots");

console.log("Labour deployment date correction rules passed.");
