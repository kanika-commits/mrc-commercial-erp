import { NextResponse } from "next/server";
import { adminClient, jsonError } from "@/lib/serverProcurementAccess";
import { requirePermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

const editable = ["debit_note_number", "debit_note_date", "debit_note_type", "reason"] as const;

async function loadDraft(request: Request, id: string) {
  const auth = await requirePermission(request, "debit_notes", "edit");
  if ("response" in auth) return { response: auth.response } as const;
  const admin = adminClient();
  const { data: note, error } = await admin.from("debit_notes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!note) return { response: jsonError("Debit Note draft was not found.", 404) } as const;
  if (note.is_deleted || String(note.status || "").toLowerCase() !== "draft" || String(note.approval_status || "").toLowerCase() === "rejected" || !note.source_purchase_order_id) return { response: jsonError("Only active contractor-recovery Debit Note drafts are editable.", 409) } as const;
  const scope = await loadActorOrganizationScope(admin, auth);
  if (!isInOrganizationScope(scope, note.organization_id)) return { response: jsonError("You do not have access to this organization.", 403) } as const;
  const { data: po, error: poError } = await admin.from("procurement_purchase_orders").select("id,organization_id,company_id,site_id,purpose,recovery_work_order_id,total_basic_amount,total_gst_amount,total_amount,po_number").eq("id", note.source_purchase_order_id).eq("organization_id", note.organization_id).maybeSingle();
  if (poError) throw poError;
  if (!po || po.purpose !== "Recover from contractor" || po.recovery_work_order_id !== note.work_order_id) return { response: jsonError("The Debit Note source Purchase Order linkage is invalid.", 409) } as const;
  const { data: workOrder, error: workOrderError } = await admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number").eq("id", note.work_order_id).eq("organization_id", note.organization_id).eq("company_id", po.company_id).eq("site_id", po.site_id).maybeSingle();
  if (workOrderError) throw workOrderError;
  if (!workOrder) return { response: jsonError("The linked Work Order is outside the Purchase Order scope.", 403) } as const;
  const companyAllowed = !(auth.companies as string[] | undefined)?.length || (auth.companies as string[]).includes(po.company_id);
  const siteAllowed = !(auth.sites as string[] | undefined)?.length || (auth.sites as string[]).includes(po.site_id);
  if (!auth.isGlobalAccess && !companyAllowed || !auth.isGlobalAccess && !siteAllowed) return { response: jsonError("You do not have access to this Purchase Order scope.", 403) } as const;
  return { auth, admin, note, po, workOrder } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await loadDraft(request, (await context.params).id);
    if ("response" in result) return result.response;
    return NextResponse.json({ debit_note: result.note, source_purchase_order: result.po, work_order: result.workOrder });
  } catch (error: any) { return jsonError(error.message || "Failed to load recovery Debit Note draft.", 500); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await loadDraft(request, (await context.params).id);
    if ("response" in result) return result.response;
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, string> = {};
    for (const field of editable) if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = String(body[field] ?? "").trim();
    if (patch.debit_note_number !== undefined && !patch.debit_note_number) return jsonError("Debit Note Number is required.", 400);
    if (patch.debit_note_date !== undefined && !patch.debit_note_date) return jsonError("Debit Note Date is required.", 400);
    if (patch.reason !== undefined && !patch.reason) return jsonError("Reason is required.", 400);
    const update = await result.admin.from("debit_notes").update(patch).eq("id", result.note.id).eq("organization_id", result.note.organization_id).eq("source_purchase_order_id", result.po.id).eq("status", "Draft").select("id,status,approval_status,source_purchase_order_id,work_order_id,debit_note_number,debit_note_date,debit_note_type,reason,gross_amount,gst_amount,total_amount,source_purchase_order_documents").single();
    if (update.error) return jsonError(update.error.message || "Failed to update recovery Debit Note draft.", 500);
    return NextResponse.json({ debit_note: update.data, source_purchase_order: result.po, work_order: result.workOrder });
  } catch (error: any) { return jsonError(error.message || "Failed to update recovery Debit Note draft.", 500); }
}
