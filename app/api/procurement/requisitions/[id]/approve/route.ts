import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { actorFields, adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, APPROVAL_MODULE, requireProcurementPermission } from "@/lib/serverProcurementAccess";

async function load(admin: any, auth: any, id: string) {
  let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("id,organization_id,company_id,site_id,requisition_number,status,procurement_flow").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
  const isApprovalAdmin = auth.isGlobalAccess === true || (auth.roleCodes || []).includes("super_admin") || (auth.roleCodes || []).includes("platform_owner");
  if (isApprovalAdmin) query = admin.from("purchase_requisitions").select("id,organization_id,company_id,site_id,requisition_number,status,procurement_flow").eq("id", id).neq("status", "deleted").maybeSingle();
  if (!query) return null;
  query = applyCompanySiteAccess(query, auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, APPROVAL_MODULE, "approve");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const payload = await request.json().catch(() => ({})); const note = String(payload.note || "").trim() || null;
    const admin = adminClient();
  const row = await load(admin, auth, id);
  if (!row) return jsonError("Requisition was not found.", 404);
    const { count: lineStateCount, error: lineStateError } = await admin.from("purchase_requisition_line_approval_state").select("id", { count: "exact", head: true }).eq("requisition_id", id);
    if (lineStateError) throw lineStateError;
    const actor = actorFields(auth.user);
    if (row.procurement_flow === "billing_engineer") {
      if (!Array.isArray(payload.line_keys) || payload.line_keys.length === 0) return jsonError("Select at least one actionable material line.", 400);
      const result = await admin.rpc("approve_purchase_requisition_billing_atomic", { p_requisition_id: id, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email, line_keys: payload.line_keys }, p_reason: note });
      if (result.error) throw result.error;
      try {
        await recordAuditEvent(admin, auth.user, { organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: row.requisition_number, action: "approve", actionCategory: "workflow", activityLabel: "Approved by Requisition Approver", description: `Approved purchase requisition ${row.requisition_number}.`, reason: note, oldValues: { status: row.status }, newValues: result.data }, request);
      } catch (auditError) {
        console.error("[Procurement Audit] Billing approval audit failed", auditError);
      }
      return NextResponse.json({ ok: true, ...result.data });
    }
    if ((lineStateCount || 0) > 0) {
      if (!Array.isArray(payload.line_keys) || payload.line_keys.length === 0) return jsonError("Select at least one actionable material line.", 400);
      const result = await admin.rpc("approve_purchase_requisition_lines_atomic", { p_requisition_id: id, p_organization_id: row.organization_id, p_line_keys: payload.line_keys, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_action_note: note });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, ...result.data });
    }
    const result = await admin.rpc("approve_purchase_requisition_layer_atomic", { p_requisition_id: id, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_action_note: note });
    if (result.error) throw result.error;
    try {
      await recordAuditEvent(admin, auth.user, { organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: row.requisition_number, action: "approve", actionCategory: "workflow", activityLabel: "Approved Purchase Requisition", description: `Approved purchase requisition ${row.requisition_number}.`, reason: note, oldValues: { status: row.status }, newValues: result.data }, request);
    } catch (auditError) {
      console.error("[Procurement Audit] Requisition workflow audit failed", auditError);
    }
    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update requisition approval." }, { status: 500 }); }
}
