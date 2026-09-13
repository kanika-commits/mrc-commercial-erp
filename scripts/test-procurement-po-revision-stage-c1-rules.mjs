import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const source = fs.readFileSync("supabase/migrations/202609100016_hr_employee_company_assignments_po_approver_snapshot.sql", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609120004_procurement_po_revision_stage_c1_workflow.sql", "utf8");
for (const marker of ["when 'submit'", "when 'approve'", "when 'send_back'", "when 'reject'", "when 'issue'", "supporting_documents_manifest", "submitted_by", "submitted_at", "approved_by", "approved_at", "issued_by", "issued_at", "procurement_purchase_order_events", "approved_by_employee_id", "approved_by_company_id", "approved_by_company_name", "approved_by_designation_id", "approved_by_designation_name", "approved_signature_profile_id", "security definer", "set search_path", "revoke all on function", "grant execute on function"]) {
  assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
const sourceStart = source.indexOf("create or replace function public.transition_procurement_purchase_order_atomic");
const sourceEnd = source.indexOf("$$;", sourceStart) + 3;
const hash = crypto.createHash("sha256").update(source.slice(sourceStart, sourceEnd)).digest("hex");
assert.equal(hash, "7516e3f853613d0a7c7749f9a555b55ea534d761fdd143bdef7e875470cbcdbb", "unexpected 090016 function source hash");
assert.match(migration, /BASELINE_090016_FUNCTION_SHA256: 7516e3f853613d0a7c7749f9a555b55ea534d761fdd143bdef7e875470cbcdbb/);
for (const marker of ["previous_revision_id", "revision_diff_snapshot", "revision_line_key", "Revision identity cannot be changed", "superseded_by_revision_id", "no longer the effective revision", "revision_submitted", "revision_approved", "revision_superseded"]) assert.match(migration, new RegExp(marker, "i"));
assert.doesNotMatch(migration, /revision_reason/i);
console.log(`PO revision Stage C1 rules: PASS (${hash})`);
