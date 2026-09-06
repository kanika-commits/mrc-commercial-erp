import assert from "node:assert/strict";
import fs from "node:fs";

const security = fs.readFileSync("supabase/migrations/202609060006_procurement_purchase_orders_non_rfq_security.sql", "utf8");
const functions = [
  "supabase/migrations/202609060002_procurement_purchase_orders_non_rfq_create_rpcs.sql",
  "supabase/migrations/202609060003_procurement_purchase_orders_non_rfq_master_resolver.sql",
  "supabase/migrations/202609060004_procurement_purchase_orders_non_rfq_update_rpcs.sql",
  "supabase/migrations/202609060005_procurement_purchase_orders_non_rfq_workflow_documents.sql",
].map((path) => fs.readFileSync(path, "utf8")).join("\n");

for (const table of ["procurement_purchase_order_sequences", "procurement_purchase_orders", "procurement_purchase_order_items", "procurement_purchase_order_events", "procurement_purchase_order_documents"]) {
  assert.match(security, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(security, new RegExp(`revoke all on table[\\s\\S]*public\\.${table}`));
  assert.match(security, new RegExp(`grant all on table[\\s\\S]*public\\.${table}[\\s\\S]*to service_role`));
}

assert.match(security, /from public, anon, authenticated/);
assert.match(security, /to service_role/);
assert.doesNotMatch(security, /create policy|using \(true\)|with check \(true\)/i);
assert.doesNotMatch(security, /procurement_rfqs|procurement_rfq_|final_selection/);

for (const name of [
  "next_procurement_purchase_order_number",
  "create_procurement_purchase_order_draft_atomic",
  "create_procurement_purchase_order_draft_idempotent_atomic",
  "resolve_procurement_po_master_snapshot",
  "update_procurement_purchase_order_draft_atomic",
  "update_procurement_purchase_order_draft_with_additional_charges",
  "update_procurement_po_draft_with_additional_charges_atomic",
  "set_procurement_purchase_order_freight_atomic",
  "transition_procurement_purchase_order_atomic",
  "add_procurement_purchase_order_document_atomic",
  "remove_procurement_purchase_order_document_atomic",
  "reorder_procurement_purchase_order_documents_atomic",
]) {
  assert.match(functions, new RegExp(`create (?:or replace )?function public\\.${name}`, "i"));
  const functionIndex = functions.indexOf(`public.${name}`);
  const functionStart = Math.max(functions.lastIndexOf("CREATE", functionIndex), functions.lastIndexOf("create", functionIndex));
  const end = functions.indexOf("$$;", functionIndex);
  const functionBlock = functions.slice(functionStart, end === -1 ? undefined : end);
  assert.match(functionBlock, /security definer/i);
  assert.match(functionBlock, /set search_path/i);
}

console.log("Part 6 Purchase Order security rules passed");
