import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");

assert.match(page, /setShowDeploymentForm\(false\);[\s\S]+await load\(\);/, "successful deployment closes and refreshes the modal state");
assert.match(page, /const latestDeployment = worker\.status === "inactive" \? previousDeployment : currentDeployment/);
assert.match(page, /company_id: latestDeployment\?\.company_id/);
assert.match(page, /site_id: latestDeployment\?\.site_id/);
assert.match(page, /commercial_model: worker\.status === "inactive" \? "daily_wage" : latestDeployment\?\.commercial_model/);
assert.match(page, /labour_trade_id: latestDeployment\?\.labour_trade_id/);
assert.match(page, /wage_rate: worker\.status === "inactive" && latestDeployment\?\.wage_rate/);
assert.doesNotMatch(page, /company_id: previousDeployment\?\.company_id/);
assert.doesNotMatch(page, /site_id: previousDeployment\?\.site_id/);

console.log("Labour reactivation popup close and latest-deployment defaults contract passed.");
