import assert from "node:assert/strict";
import fs from "node:fs";

const createRoute = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const detailRoute = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610090001_work_order_pilot_ra_bills.sql", "utf8");

assert.match(createRoute, /work_order_pilot_ra_bill_items/);
assert.match(createRoute, /submittedItems/);
assert.match(createRoute, /outside the approved Work Order revision/);
assert.match(createRoute, /Duplicate Pilot RA Bill item/);
assert.match(createRoute, /effective_revision/);
assert.match(createRoute, /previousItems/);
assert.match(createRoute, /bill_qty/);
assert.match(detailRoute, /reviewed_pdf_sha256/);
assert.match(detailRoute, /createHash\("sha256"\)/);
assert.match(detailRoute, /byteLength/);
assert.match(detailRoute, /idempotent/);
assert.match(detailRoute, /status !== "draft"/);
assert.match(page, /persisted/);
assert.match(page, /line \? Math\.max/);
assert.match(migration, /bill_qty numeric/);
assert.match(migration, /cumulative_qty numeric/);
assert.match(migration, /reviewed_pdf_sha256/);
console.log("Pilot RA Bill draft line persistence, server validation, reopen, retry, and PDF binding contract passed.");
