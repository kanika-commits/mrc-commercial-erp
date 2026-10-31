import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const api = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610130004_work_order_pilot_ra_bill_rejected_number_reuse.sql", "utf8");

assert.match(page, /toLocaleString\("en-IN"/);
assert.match(page, /type=\"number\"/);
assert.match(api, /eq\("organization_id", order\.organization_id\)/);
assert.match(api, /is\("deleted_at", null\)/);
assert.match(api, /status.*rejected|neq\("status", "rejected"\)/);
assert.match(api, /eq\("work_order_id", order\.id\).*eq\("bill_number", billNumber\)/s);
assert.match(migration, /where deleted_at is null and status <> 'rejected'/);
console.log("Pilot RA Bill amount formatting and active-number contract: PASS");
