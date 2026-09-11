import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";
import { loadFrozenSupportingDocuments } from "@/lib/procurement/poSupportingDocumentIntegrity";
const MODULE = "procurement_purchase_orders";
function actor(auth: any) { return { user_id: auth.user.id, name: text(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email), email: auth.user.email || null }; }
async function load(request: Request, id: string, action: string) {
  const auth = action === "view" ? await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "edit" }, { moduleCode: MODULE, actionCode: "approve" }, { moduleCode: MODULE, actionCode: "issue" }]) : await requireProcurementPermission(request, MODULE, action);
  if ("response" in auth) return { response: auth.response } as const; const admin = adminClient(); let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, company:companies!procurement_purchase_orders_company_id_fkey(id,company_name,company_code), site:sites(id,site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(*)").eq("id", id).maybeSingle(), auth); query = query && applyCompanySiteAccess(query, auth); if (!query) return { response: jsonError("Purchase Order was not found.", 404) } as const; const { data, error } = await query; if (error) throw error; if (!data) return { response: jsonError("Purchase Order was not found.", 404) } as const; return { auth, admin, row: data } as const;
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "view"); if ("response" in result) return result.response; return NextResponse.json({ purchase_order: result.row }); } catch (error: any) { return jsonError(error.message || "Failed to load Purchase Order.", 500); } }
 export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "edit"); if ("response" in result) return result.response; const body = await request.json().catch(() => ({})); const commercial = body.commercial || {}; if (Array.isArray(body.key_terms)) commercial.key_terms = body.key_terms; if (Object.prototype.hasOwnProperty.call(commercial, "additional_charges")) { if (!Array.isArray(commercial.additional_charges) || commercial.additional_charges.some((charge: any) => !text(charge?.name) || !Number.isFinite(Number(charge?.amount)) || Number(charge.amount) < 0)) return jsonError("Each additional charge needs a name and a valid non-negative amount.", 400); commercial.additional_charges = commercial.additional_charges.map((charge: any) => ({ name: text(charge.name), amount: Number(charge.amount) })); } const items = Array.isArray(body.items) ? body.items : []; const rpc = await result.admin.rpc(items.length ? "update_procurement_purchase_order_draft_with_items_atomic" : (Object.prototype.hasOwnProperty.call(commercial, "additional_charges") ? "update_procurement_po_draft_with_additional_charges_atomic" : "update_procurement_purchase_order_draft_atomic"), { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_fields: { po_date: text(body.po_date), delivery: body.delivery || {}, master_selection: body.master_selection || {}, commercial, standard_terms: text(body.standard_terms), items }, p_actor: actor(result.auth) }); if (rpc.error) throw rpc.error; if (Object.prototype.hasOwnProperty.call(commercial, "freight_amount")) { const freightResult = await result.admin.rpc("set_procurement_purchase_order_freight_atomic", { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_freight_amount: Number(commercial.freight_amount || 0), p_actor: actor(result.auth) }); if (freightResult.error) throw new Error(`Purchase Order draft was updated, but Freight could not be saved: ${freightResult.error.message}`); } return NextResponse.json({ result: rpc.data }); } catch (error: any) { return jsonError(error.message || "Failed to save Purchase Order draft.", 500); } }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await load(request, id, "edit");
    if ("response" in result) return result.response;
    if (result.row.status !== "draft") return jsonError("Only draft Purchase Orders can be deleted.", 409);
    const documents = await result.admin.from("procurement_purchase_order_documents").select("id,storage_bucket,storage_key,original_file_name,size_bytes").eq("purchase_order_id", id).eq("organization_id", result.row.organization_id);
    if (documents.error) throw documents.error;
    for (const document of documents.data || []) await createPrivateStorageAdapter(result.admin).delete({ bucket: document.storage_bucket, key: document.storage_key });
    const [items, events, documentRows] = await Promise.all([
      result.admin.from("procurement_purchase_order_items").delete().eq("purchase_order_id", id),
      result.admin.from("procurement_purchase_order_events").delete().eq("purchase_order_id", id),
      result.admin.from("procurement_purchase_order_documents").delete().eq("purchase_order_id", id).eq("organization_id", result.row.organization_id),
    ]);
    if (items.error) throw items.error; if (events.error) throw events.error; if (documentRows.error) throw documentRows.error;
    const deleted = await result.admin.from("procurement_purchase_orders").delete().eq("id", id).eq("organization_id", result.row.organization_id).eq("status", "draft");
    if (deleted.error) throw deleted.error;
    await insertDeleteAudit(result.admin, result.auth.user, { organizationId: result.row.organization_id, moduleCode: MODULE, documentType: "purchase_order", documentId: id, documentNumber: result.row.po_number, deletionReason: "Draft Purchase Order deleted by user.", recordSnapshot: result.row, relatedSnapshot: { source_type: result.row.source_type, source_requisition_id: result.row.source_requisition_id } });
    return NextResponse.json({ deleted: true });
  } catch (error: any) { return jsonError(error.message || "Failed to delete draft Purchase Order.", 500); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const body = await request.json().catch(() => ({})); const action = text(body.action); const requiredAction = action === "approve" ? "approve" : action === "send_back" || action === "reject" ? "reject" : action === "issue" ? "issue" : "edit"; const result = await load(request, id, requiredAction); if ("response" in result) return result.response;
  if (action === "send_back" || action === "reject") {
    if (!text(body.note)) return jsonError("A reason is required for this action.", 400);
  }
  if (action === "submit") {
    const items = Array.isArray(result.row.items) ? result.row.items : [];
    if (!result.row.vendor_id && !result.row.vendor_name_snapshot) return jsonError("A Vendor is required before submitting the Purchase Order.", 400);
    if (!items.length) return jsonError("At least one Purchase Order item is required before submission.", 400);
    if (items.some((item: any) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unit_rate)) || Number(item.unit_rate) < 0)) return jsonError("Each Purchase Order item must have a valid quantity and rate.", 400);
    const total = Number(result.row.total_amount ?? result.row.grand_total ?? 0);
    if (!Number.isFinite(total) || total < 0) return jsonError("Purchase Order totals are invalid.", 400);
  }
  if (action === "approve" && result.row.status !== "draft" && Array.isArray(result.row.supporting_documents_manifest)) {
    const packageState = await loadFrozenSupportingDocuments(result.admin, result.row);
    if (packageState.integrityError) return jsonError(packageState.integrityError, 409);
  }
  const rpc = await result.admin.rpc("transition_procurement_purchase_order_atomic", { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_action: action, p_actor: actor(result.auth), p_note: text(body.note) || null }); if (rpc.error) throw rpc.error; return NextResponse.json({ result: rpc.data }); } catch (error: any) { return jsonError(error.message || "Failed to update Purchase Order workflow.", 500); } }
