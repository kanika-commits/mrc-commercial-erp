import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609060002_procurement_purchase_orders_non_rfq_create_rpcs.sql",
  "utf8",
);

assert.match(migration, /next_procurement_purchase_order_number/);
assert.match(migration, /on conflict \(organization_id,company_id,year_month\)/);
assert.match(migration, /lpad\(v_number::text,4,'0'\)/);

assert.match(migration, /create_procurement_purchase_order_draft_atomic/);
assert.match(migration, /p_source_type not in \('direct','indent'\)/);
assert.doesNotMatch(migration, /final_selection|procurement_rfqs|rfq_id|rfq_vendor_id|final_selection_id/);
assert.match(migration, /rfq_number_snapshot/);
assert.match(migration, /Authenticated actor is required/);
assert.match(migration, /c\.organization_id = p_organization_id/);
assert.match(migration, /s\.company_id = p_company_id or s\.company_id is null/);
assert.match(migration, /v\.organization_id = p_organization_id/);
assert.match(migration, /standard_terms_template_id/);
assert.match(migration, /additional_charges/);
assert.match(migration, /resolve_procurement_po_master_snapshot/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /approval_status = 'approved'/);
assert.match(migration, /where po\.status <> 'rejected'/);
assert.doesNotMatch(migration, /cancelled/);
assert.match(migration, /insert into public\.procurement_purchase_order_items/);
assert.match(migration, /'created_draft'/);
assert.match(migration, /'purchase_order_id'/);
assert.match(migration, /'po_number'/);

assert.match(migration, /create_procurement_purchase_order_draft_idempotent_atomic/);
assert.match(migration, /Creation request ID is required/);
assert.match(migration, /p_creation_request_id/);
assert.match(migration, /v_existing\.source_type <> p_source_type/);
assert.match(migration, /return jsonb_build_object\(\s*'purchase_order_id'/);
assert.match(migration, /public\.create_procurement_purchase_order_draft_atomic/);
assert.match(migration, /set creation_request_id = p_creation_request_id/);

console.log("Part 2 Purchase Order RPC rules passed");
