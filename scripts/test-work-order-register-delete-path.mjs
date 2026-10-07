import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/page.tsx", "utf8");
const atomicRoute = fs.readFileSync("app/api/approvals/work-orders/[id]/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610070002_work_order_platform_owner_delete_canonical_documents.sql", "utf8");

assert.match(page, /\/api\/approvals\/work-orders\/\$\{encodeURIComponent\(deleteWorkOrder\.id\)\}/);
assert.doesNotMatch(page, /\/api\/work-orders\?work_order_id=/);
assert.match(page, /access\.roleCodes\?\.includes\("platform_owner"\)/);
assert.match(page, /NEXT_PUBLIC_VERCEL_ENV === "production"/);
assert.match(atomicRoute, /roleCodes\.includes\("platform_owner"\)/);
assert.match(atomicRoute, /delete_work_order_atomic/);
assert.match(atomicRoute, /work_order_items/);
assert.match(atomicRoute, /storageFilesPreserved: true/);
assert.match(migration, /delete from public\.work_order_items/);
assert.match(migration, /delete from public\.work_order_documents/);

console.log("Work Order register atomic-delete contract: PASS");
