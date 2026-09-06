import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { actorFields, adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, REQUISITION_MODULE, requireProcurementPermission } from "@/lib/serverProcurementAccess";

async function load(admin: any, auth: any, id: string) {
  let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("*, items:purchase_requisition_items(id, required_by_date)").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
  if (!query) return null;
  query = applyCompanySiteAccess(query, auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, REQUISITION_MODULE, "submit");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const row = await load(admin, auth, id);
    if (!row) return jsonError("Requisition was not found.", 404);
    if (!(row.items || []).length || (row.items || []).some((item: any) => !item.required_by_date)) return jsonError("Required By is required for every material line before submit.", 400);
    const actor = actorFields(auth.user);
    const rpcName = row.procurement_flow === "billing_engineer"
      ? "submit_purchase_requisition_billing_atomic"
      : "submit_purchase_requisition_for_approval_atomic";
    const result = await admin.rpc(rpcName, { p_requisition_id: id, p_actor: { user_id: auth.user.id, name: actor.updated_by_name, email: actor.updated_by_email } });
    if (result.error) {
      return NextResponse.json({
        error: result.error.message || "Failed to submit requisition.",
        details: result.error.details || null,
        hint: result.error.hint || null,
        code: result.error.code || null,
      }, { status: 400 });
    }
    try { await recordAuditEvent(admin, auth.user, { organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id, moduleCode: REQUISITION_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: row.requisition_number, action: "submit", actionCategory: "workflow", activityLabel: row.status === "sent_back" ? "Resubmitted Purchase Requisition" : "Submitted Purchase Requisition", description: `Submitted purchase requisition ${row.requisition_number}.`, oldValues: { status: row.status }, newValues: result.data }, request); } catch (auditError) { console.error("[Procurement Audit] Requisition submit audit failed", auditError); }
    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to submit requisition." }, { status: 500 }); }
}
