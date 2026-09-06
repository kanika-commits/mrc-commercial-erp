import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { actorFields, adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, APPROVAL_MODULE, requireProcurementPermission } from "@/lib/serverProcurementAccess";

async function load(admin: any, auth: any, id: string) {
  let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("id,organization_id,company_id,site_id,requisition_number,status").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
  if (!query) return null;
  query = applyCompanySiteAccess(query, auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, APPROVAL_MODULE, "reject");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const payload = await request.json().catch(() => ({})); const reason = String(payload.reason || "").trim(); if (!reason) return jsonError("Send Back reason is required.", 400);
    const admin = adminClient();
    const row = await load(admin, auth, id);
    if (!row) return jsonError("Requisition was not found.", 404);
    const actor = actorFields(auth.user);
    const result = await admin.rpc("send_back_purchase_requisition_layer_atomic", { p_requisition_id: id, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email }, p_reason: reason });
    if (result.error) throw result.error;
    try {
      await recordAuditEvent(admin, auth.user, { organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: row.requisition_number, action: "reject", actionCategory: "workflow", activityLabel: "Sent Back Purchase Requisition", description: `Sent Back purchase requisition ${row.requisition_number}.`, reason: reason, oldValues: { status: row.status }, newValues: result.data }, request);
    } catch (auditError) {
      console.error("[Procurement Audit] Requisition workflow audit failed", auditError);
    }
    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update requisition approval." }, { status: 500 }); }
}
