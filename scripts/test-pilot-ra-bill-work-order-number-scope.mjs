import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610160002_work_order_pilot_ra_bill_work_order_number_scope.sql", "utf8");
const dashboard = fs.readFileSync("app/forms/pilot/ra-bills/page.tsx", "utf8");

const scopedActive = /eq\("organization_id", order\.organization_id\).*eq\("work_order_id", order\.id\).*is\("deleted_at", null\).*neq\("status", "rejected"\)/s;
assert.match(api, scopedActive, "number lookup must use the selected Work Order active scope");
assert.match(api, /eq\("organization_id", order\.organization_id\).*eq\("work_order_id", order\.id\).*eq\("bill_number", billNumber\).*is\("deleted_at", null\).*neq\("status", "rejected"\)/s, "save duplicate check must match the Work Order scope");
assert.match(migration, /drop index if exists public\.work_order_pilot_ra_bill_active_number_key/);
assert.match(migration, /on public\.work_order_pilot_ra_bills \(organization_id, work_order_id, bill_number\)/);
assert.match(migration, /where deleted_at is null and status <> 'rejected'/);
assert.match(dashboard, /Pilot RA Bill deletion pending/);
console.log("Pilot RA Bill Work Order-scoped numbering contract: PASS");
