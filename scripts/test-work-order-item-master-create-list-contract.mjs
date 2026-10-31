import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/item-masters/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610310001_work_order_item_master_soft_delete_uniqueness.sql", "utf8");

assert.match(route, /const organizationId = resolveWriteOrganizationId\(scope\)/);
assert.match(route, /organizationId \? query\.eq\("organization_id", organizationId\) : query\.limit\(0\)/);
assert.match(route, /organization_id: targetOrganizationId/);
assert.match(route, /error\?\.code === "23505"/);
assert.match(route, /\.neq\("status", "deleted"\)/);
assert.match(migration, /drop index if exists public\.work_order_item_masters_org_header_uidx/);
assert.match(migration, /where status <> 'deleted'/);
assert.doesNotMatch(migration, /insert into|update public|delete from public/);

console.log("Work Order Item Master create/list scope and soft-delete contract passed");
