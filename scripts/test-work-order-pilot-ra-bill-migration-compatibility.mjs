import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202610100001_work_order_pilot_ra_bill_persistence_compatibility.sql", "utf8");
const approval = fs.readFileSync("app/api/work-orders/pilot-ra-bills/approvals/[id]/route.ts", "utf8");
const detail = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/route.ts", "utf8");

for (const column of ["bill_qty", "cumulative_qty", "current_amount"]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
assert.match(migration, /sent_back/);
assert.match(migration, /work_order_pilot_ra_bill_reviewed_artifacts/);
assert.match(migration, /pdf_bytes bytea/);
assert.match(detail, /work_order_pilot_ra_bill_reviewed_artifacts/);
assert.match(detail, /pdf_bytes: artifact/);
assert.match(detail, /createHash\("sha256"\)/);
assert.match(approval, /loadActorOrganizationScope/);
assert.match(approval, /applyOrganizationScope/);
assert.match(approval, /creation_request_id/);
assert.doesNotMatch(migration, /public\.ra_bills\b|public\.ra_bill_items\b/);
console.log("Pilot RA Bill migration compatibility, artifact persistence, and approval scope contract passed.");
