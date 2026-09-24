import fs from 'node:fs';
import assert from 'node:assert/strict';

const correctionPath = 'supabase/migrations/202609240004_procurement_po_letterhead_creation_contract.sql';
const correction = fs.readFileSync(correctionPath, 'utf8');
const source = fs.readFileSync('supabase/migrations/202609240002_procurement_po_live_master_item_identity.sql', 'utf8');
const route = fs.readFileSync('app/api/procurement/purchase-orders/route.ts', 'utf8');

assert.match(correction, /create_procurement_purchase_order_draft_v2_atomic/);
assert.match(correction, /create_procurement_purchase_order_draft_idempotent_v2_atomic/);
assert.match(correction, /public\.create_procurement_purchase_order_draft_v2_atomic\(/);
assert.match(correction, /resolve_procurement_po_master_snapshot\(/);
assert.match(correction, /v_item \? 'item_id'/);
assert.match(correction, /item_id,\s*source_requisition_id/s);
assert.match(correction, /v_master_item_id/);
assert.match(correction, /p_source_type not in \('direct','indent'\)/);
assert.match(correction, /approved Indent|approved indent/);
assert.match(correction, /remaining approved Indent quantity|remaining approved indent quantity/);
assert.match(correction, /standard_terms_template_id/);
assert.match(correction, /additional_charges/);
assert.match(correction, /creation_request_id/);
assert.match(correction, /pg_advisory_xact_lock/);

assert.doesNotMatch(correction, /No Ready default Purchase Order template is configured for the selected company\./);
assert.doesNotMatch(correction, /from public\.procurement_purchase_order_templates/);
assert.doesNotMatch(correction, /from public\.procurement_purchase_order_template_versions/);
assert.doesNotMatch(correction, /v_template_id uuid/);
assert.doesNotMatch(correction, /v_template_version_id uuid/);
assert.doesNotMatch(correction, /v_template_snapshot jsonb/);
assert.doesNotMatch(correction, /update_procurement_purchase_order_draft_with_items_v2_atomic/);

assert.match(source, /No Ready default Purchase Order template is configured for the selected company\./);
assert.match(route, /create_procurement_purchase_order_draft_idempotent_v2_atomic/);
assert.match(route, /create_procurement_purchase_order_draft_v2_atomic/);

console.log('PASS: PO V2 Letterhead-driven creation contract');
