import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync("supabase/migrations/202608310001_procurement_purchase_order_templates.sql", "utf8");
const baseline = fs.readFileSync("supabase/migrations/202609060001_procurement_purchase_orders_non_rfq_baseline.sql", "utf8");
const createRpcs = fs.readFileSync("supabase/migrations/202609060002_procurement_purchase_orders_non_rfq_create_rpcs.sql", "utf8");

/*
assert.match(migration, /to_regprocedure\('public\.create_procurement_purchase_order_draft_atomic\(text,uuid,uuid,uuid,uuid,jsonb,uuid,text,jsonb,jsonb,jsonb\)'\)/);
assert.match(migration, /t\.organization_id = p_organization_id/);
assert.match(migration, /t\.company_id = p_company_id/);
assert.match(migration, /t\.status = ''active'' and t\.is_default/);
assert.match(migration, /v\.status = ''active'' and v\.readiness_status = ''ready''/);
assert.match(migration, /order by v\.version_number desc, v\.id desc/);
assert.match(migration, /for update of t, v/);
assert.match(migration, /commercial_snapshot, standard_terms_snapshot, template_id, template_version_id, template_snapshot/);
assert.match(migration, /coalesce\(p_fields->''commercial'',''\{\}''::jsonb\)/);
assert.match(migration, /v_terms_snapshot::text, v_template_id, v_template_version_id, v_template_snapshot/);
assert.match(migration, /standard_terms_template_id/);
assert.match(migration, /x\.organization_id = p_organization_id/);
assert.match(migration, /x\.company_id = p_company_id/);
assert.match(migration, /x\.status = ''active''/);
assert.match(migration, /s\.status = ''active''/);
assert.match(migration, /order by s\.sort_order, s\.id/);
assert.match(migration, /No Ready default Purchase Order template is configured/);
assert.match(migration, /Selected Standard Terms Set is invalid for the selected company/);
assert.match(migration, /v_template_id uuid;/);
assert.match(migration, /v_template_version_id uuid;/);
assert.match(migration, /v_template_snapshot jsonb;/);
assert.match(migration, /v_terms_snapshot jsonb;/);
assert.match(migration, /Purchase Order draft RPC freeze behavior verification failed/);
assert.doesNotMatch(migration, /update public\.procurement_purchase_orders/i);
assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

assert.match(idempotency, /pg_advisory_xact_lock/);
assert.match(idempotency, /creation_request_id=p_creation_request_id/);
assert.match(idempotency, /if found then/);
assert.match(idempotency, /return jsonb_build_object\('purchase_order_id',v_existing\.id/);
assert.match(idempotency, /create_procurement_purchase_order_draft_atomic\(/);
*/

assert.match(schema, /procurement_purchase_order_templates/);
assert.match(schema, /procurement_purchase_order_template_versions/);
assert.match(schema, /readiness_status/);
assert.match(schema, /alter table public\.procurement_purchase_orders add column if not exists template_id/);
assert.match(schema, /alter table public\.procurement_purchase_orders add column if not exists template_version_id/);
assert.match(schema, /alter table public\.procurement_purchase_orders add column if not exists template_snapshot/);
assert.match(baseline, /template_id uuid references/);
assert.match(baseline, /template_version_id uuid references/);
assert.match(baseline, /template_snapshot jsonb/);
assert.match(createRpcs, /select t\.id, v\.id, jsonb_build_object\([\s\S]+template_snapshot/);
assert.match(createRpcs, /t\.organization_id = p_organization_id/);
assert.match(createRpcs, /t\.company_id = p_company_id/);
assert.match(createRpcs, /t\.status = 'active'/);
assert.match(createRpcs, /t\.is_default/);
assert.match(createRpcs, /v\.status = 'active'/);
assert.match(createRpcs, /v\.readiness_status = 'ready'/);
assert.match(createRpcs, /order by v\.version_number desc, v\.id desc/);
assert.match(createRpcs, /for update of t, v/);
assert.match(createRpcs, /template_id,\s*template_version_id,\s*template_snapshot/);
assert.match(createRpcs, /v_template_id,\s*v_template_version_id,\s*v_template_snapshot/);
assert.match(createRpcs, /No Ready default Purchase Order template is configured/);
assert.match(createRpcs, /standard_terms_template_id/);
assert.match(createRpcs, /v_terms_snapshot/);
assert.match(createRpcs, /create_procurement_purchase_order_draft_idempotent_atomic\(/);
assert.doesNotMatch(createRpcs, /procurement_rfqs|procurement_rfq_|final_selection|rfq_vendor_id/);

console.log("PO template freeze rules passed");
