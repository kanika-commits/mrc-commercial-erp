import assert from "node:assert/strict";
import fs from "node:fs";

const shared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const daily = fs.readFileSync("app/api/labour/attendance/daily/route.ts", "utf8");
const monthly = fs.readFileSync("app/api/labour/attendance/monthly/route.ts", "utf8");

assert.match(shared, /\.eq\("organization_id", input\.organizationId\)/);
assert.match(shared, /\.eq\("company_id", input\.companyId\)/);
assert.match(shared, /\.eq\("site_id", input\.siteId\)/);
assert.match(shared, /\.lte\("effective_from", input\.attendanceDate\)/);
assert.match(shared, /effective_to\.is\.null,effective_to\.gte\.\$\{input\.attendanceDate\}/);
assert.match(shared, /from\("erp_audit_logs"\)/);
assert.match(shared, /newValues\.status.*inactive/);
assert.match(shared, /input\.attendanceDate >= inactivationDate/);
assert.match(shared, /!historicalDate \|\| !inactivationDate/);
assert.match(daily, /allowHistoricallyInactiveWorker: true/);
assert.match(monthly, /allowHistoricallyInactiveWorker: true/);
assert.match(shared, /\.in\("status", \["active", "ended"\]\)/);
assert.match(shared, /worker\.status !== "active"/);

console.log("labour attendance roster inactivation rules: PASS");
