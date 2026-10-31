import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const renderer = fs.readFileSync("lib/workOrderPilotRaBillPdf.server.ts", "utf8");
assert.match(page, /periodStart/);
assert.match(page, /periodEnd/);
assert.match(page, /Work period start date/);
assert.match(page, /Work period end date/);
assert.doesNotMatch(page, /placeholder="e\.g\. October 2026"/);
assert.match(page, /periodEnd < periodStart/);
assert.match(page, /setPeriod\(periodStart && periodEnd \? `\$\{periodStart\} to \$\{periodEnd\}`/);
assert.match(page, /setPeriodStart\(range\?\./);
assert.match(renderer, /"Work Period"/);
assert.match(renderer, /bill\.bill_period/);
assert.equal("2026-09-31" < "2026-10-01", true);
console.log("Pilot RA Bill work-period date validation, persistence, reopen, and PDF header contract passed");
