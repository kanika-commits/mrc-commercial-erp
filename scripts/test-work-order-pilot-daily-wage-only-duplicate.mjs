import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202610290001_work_order_daily_wage_contract.sql", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const availability = fs.readFileSync("app/api/work-orders/pilot/availability/route.ts", "utf8");

assert.match(migration, /if v_type <> 'daily wage' then return '\{\}'::jsonb; end if/);
assert.match(migration, /if new\.creation_request_id is null[\s\S]+v_type <> 'daily wage' then return new; end if/);
assert.match(migration, /p_company_id uuid[\s\S]+p_site_id uuid[\s\S]+p_vendor_id uuid/);
assert.match(migration, /company_id = p_company_id and site_id = p_site_id/);
assert.match(migration, /pg_advisory_xact_lock/);
for (const status of ["rejected", "cancelled", "canceled", "voided"]) assert.match(migration, new RegExp(status));
assert.match(create, /validate_work_order_pilot_creation/);
assert.match(create, /p_company_id: company\.id/);
assert.match(create, /p_site_id: site\.id/);
assert.match(create, /if \(woType === "Daily Wage"\)[\s\S]+duplicate\?\.existing_work_order_id/);
assert.match(availability, /workOrderType !== "Daily Wage"/);
assert.match(availability, /p_company_id: company\.id/);
assert.match(availability, /p_site_id: site\.id/);
assert.match(availability, /validate_work_order_pilot_creation/);
assert.match(availability, /already has a Daily Wage Work Order/);

console.log("Pilot Daily Wage-only duplicate contract passed");
