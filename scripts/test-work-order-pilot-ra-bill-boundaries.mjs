import assert from "node:assert/strict";
import fs from "node:fs";
const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610090001_work_order_pilot_ra_bills.sql", "utf8");
assert.match(route, /approval_status\", \"approved\"/); assert.match(route, /not\(\"creation_request_id\", \"is\", null\)/); assert.match(route, /work_order_pilot_ra_bills/); assert.match(route, /work_order_pilot_revisions/); assert.match(route, /effective_revision/); assert.match(route, /previous_basic/); assert.doesNotMatch(route, /from\(\"ra_bills\"\)|from\(\"ra_bill_items\"\)/);
assert.match(migration, /work_order_pilot_ra_bills/); assert.match(migration, /work_order_pilot_ra_bill_items/); assert.match(migration, /submit_work_order_pilot_ra_bill/); assert.match(migration, /approve_work_order_pilot_ra_bill/);
console.log("Pilot RA Bill eligibility and legacy-isolation regression passed.");
