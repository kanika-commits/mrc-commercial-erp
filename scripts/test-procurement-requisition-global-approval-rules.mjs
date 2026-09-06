import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202608310004_procurement_requisition_global_approval_override.sql", "utf8");
const billingMigration = fs.readFileSync("supabase/migrations/202608310005_procurement_requisition_billing_global_approval_override.sql", "utf8");
const api = fs.readFileSync("app/api/procurement/requisitions/[id]/approve/route.ts", "utf8");
const queue = fs.readFileSync("app/api/procurement/requisitions/route.ts", "utf8");

assert.match(migration, /join public\.roles role/);
assert.match(migration, /role\.role_code in \('platform_owner', 'super_admin'\)/);
assert.match(migration, /current_step\.approver_user_id <> actor_id and not is_global_actor/);
assert.match(migration, /revoke all on function public\.approve_purchase_requisition_lines_atomic/);
assert.match(billingMigration, /public\.approve_purchase_requisition_billing_atomic\(\n  p_requisition_id uuid,\n  p_actor jsonb,\n  p_reason text default null/);
assert.match(billingMigration, /role\.role_code in \('platform_owner', 'super_admin'\)/);
assert.match(billingMigration, /v_step\.approver_user_id <> v_actor_id and not v_is_global_actor/);
assert.match(billingMigration, /revoke all on function public\.approve_purchase_requisition_billing_atomic/);
assert.match(api, /requireProcurementPermission\(request, APPROVAL_MODULE, "approve"\)/);
assert.match(api, /approve_purchase_requisition_billing_atomic/);
assert.match(queue, /line_actionable: Boolean/);
assert.match(queue, /currentStep\?\.approver_user_id === auth\.user\.id \|\| isApprovalAdmin/);
console.log("Material Indent global approval rules passed");
