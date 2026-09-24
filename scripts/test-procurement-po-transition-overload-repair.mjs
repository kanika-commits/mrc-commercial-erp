import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202609240005_procurement_po_transition_overload_repair.sql", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");

assert.match(migration, /create or replace function public\.transition_procurement_purchase_order_legacy_atomic\(/);
assert.match(migration, /create or replace function public\.transition_procurement_purchase_order_atomic\([\s\S]*p_freeze_projection jsonb default null::jsonb/);
assert.match(migration, /return public\.transition_procurement_purchase_order_legacy_atomic\(/);
assert.match(migration, /drop function public\.transition_procurement_purchase_order_atomic\(uuid,uuid,text,jsonb,text\);/);
assert.match(migration, /revoke all on function public\.transition_procurement_purchase_order_atomic\(uuid,uuid,text,jsonb,text,jsonb\)/);
assert.match(migration, /grant execute on function public\.transition_procurement_purchase_order_atomic\(uuid,uuid,text,jsonb,text,jsonb\) to service_role/);
assert.doesNotMatch(migration, /return public\.transition_procurement_purchase_order_atomic\(/);
assert.match(route, /p_freeze_projection: freezePayload/);

console.log("PASS: PO transition overload repair contract");
