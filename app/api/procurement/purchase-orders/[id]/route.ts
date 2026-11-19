import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";
import { loadFrozenSupportingDocuments } from "@/lib/procurement/poSupportingDocumentIntegrity";
import { loadAuthorizedPurchaseOrderVendorSnapshot, purchaseOrderVendorSnapshotUpdate } from "@/lib/procurement/poDraftVendorSnapshot.server";
import { insertNotificationOnce, resolveNotificationRecipients } from "@/lib/serverNotificationRecipients";
const MODULE = "procurement_purchase_orders";
const PO_PURPOSES = new Set(["General Purchase", "Asset Purchase", "Recover from contractor"]);
async function persistRecoveryFields(admin: any, purchaseOrderId: string, organizationId: string, purpose: string, recoveryVendorId: string, recoveryWorkOrderId: string) {
  const result = await admin.from("procurement_purchase_orders")
    .update(purpose === "Recover from contractor" ? { purpose, recovery_vendor_id: recoveryVendorId, recovery_work_order_id: recoveryWorkOrderId } : { purpose })
    .eq("id", purchaseOrderId)
    .eq("organization_id", organizationId);
  if (result.error) throw result.error;
}
function normalizePurchaseOrderItems(items: any[]) {
  return items.map((item) => {
    const { description, specification, ...rest } = item || {};
    return { ...rest, specification: description ?? specification ?? "" };
  });
}
function actor(auth: any) { return { user_id: auth.user.id, name: text(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email), email: auth.user.email || null }; }
async function load(request: Request, id: string, action: string) {
  const auth = action === "view" ? await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "edit" }, { moduleCode: MODULE, actionCode: "approve" }, { moduleCode: MODULE, actionCode: "issue" }]) : await requireProcurementPermission(request, MODULE, action);
  if ("response" in auth) return { response: auth.response } as const; const admin = adminClient(); let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, site:sites(id,site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(*)").eq("id", id).maybeSingle(), auth); query = query && applyCompanySiteAccess(query, auth); if (!query) return { response: jsonError("Purchase Order was not found.", 404) } as const; const { data, error } = await query; if (error) throw error; if (!data) return { response: jsonError("Purchase Order was not found.", 404) } as const;
  const companyResult = await admin.from("companies").select("id,company_name,company_code,organization_id").eq("id", data.company_id).eq("organization_id", data.organization_id).maybeSingle();
  if (companyResult.error) throw companyResult.error;
  if (!companyResult.data) return { response: jsonError("Purchase Order company was not found.", 404) } as const;
  data.company = companyResult.data;
  let revisionHistory: any[] = [data];
  if (data.revision_family_id) {
    let familyQuery: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("id,po_number,revision_no,status,revision_family_id,previous_revision_id,superseded_by_revision_id,created_at,submitted_at,approved_at,company_id,site_id,vendor_id").eq("revision_family_id", data.revision_family_id).order("revision_no", { ascending: false }), auth);
    familyQuery = familyQuery && applyCompanySiteAccess(familyQuery, auth);
    if (familyQuery) {
      const familyResult = await familyQuery;
      if (familyResult.error) throw familyResult.error;
      revisionHistory = familyResult.data || revisionHistory;
    }
  }
  return { auth, admin, row: data, revisionHistory } as const;
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "view"); if ("response" in result) return result.response; return NextResponse.json({ purchase_order: result.row, revision_history: result.revisionHistory }); } catch (error: any) { return jsonError(error.message || "Failed to load Purchase Order.", 500); } }
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const result = await load(request, id, "edit"); if ("response" in result) return result.response; const body = await request.json().catch(() => ({})); const commercial = body.commercial || {}; if (Array.isArray(body.key_terms)) commercial.key_terms = body.key_terms; if (Object.prototype.hasOwnProperty.call(commercial, "additional_charges")) { if (!Array.isArray(commercial.additional_charges) || commercial.additional_charges.some((charge: any) => !text(charge?.name) || !Number.isFinite(Number(charge?.amount)) || Number(charge.amount) < 0)) return jsonError("Each additional charge needs a name and a valid non-negative amount.", 400); commercial.additional_charges = commercial.additional_charges.map((charge: any) => ({ name: text(charge.name), amount: Number(charge.amount) })); } const items = normalizePurchaseOrderItems(Array.isArray(body.items) ? body.items : []);
    const requestedVendorId = text(body.vendor_id);
    const vendorRefresh = requestedVendorId ? await loadAuthorizedPurchaseOrderVendorSnapshot(result.admin, result.row.organization_id, requestedVendorId) : null;
    if (vendorRefresh?.error) return jsonError(vendorRefresh.error, 400);
    let expectedOriginalItemIds: string[] | undefined;
    if (items.length) {
      if (!Array.isArray(body.expected_original_item_ids) || body.expected_original_item_ids.some((value: any) => typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))) return jsonError("Expected original Purchase Order item IDs are invalid. Reload the Purchase Order before saving.", 400);
      const normalizedIds = (body.expected_original_item_ids as string[]).map((value) => value.toLowerCase());
      if (new Set(normalizedIds).size !== normalizedIds.length) return jsonError("Expected original Purchase Order item IDs must not contain duplicates.", 400);
      expectedOriginalItemIds = normalizedIds;
    }
    const rpc = await result.admin.rpc(items.length ? "update_procurement_purchase_order_draft_with_items_atomic" : (Object.prototype.hasOwnProperty.call(commercial, "additional_charges") ? "update_procurement_po_draft_with_additional_charges_atomic" : "update_procurement_purchase_order_draft_atomic"), { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_fields: { po_date: text(body.po_date), delivery: body.delivery || {}, master_selection: body.master_selection || {}, commercial, standard_terms: text(body.standard_terms), standard_terms_template_id: text(body.standard_terms_template_id), standard_terms_sections: Array.isArray(body.standard_terms_sections) ? body.standard_terms_sections : [], items, ...(expectedOriginalItemIds ? { expected_original_item_ids: expectedOriginalItemIds } : {}) }, p_actor: actor(result.auth) }); if (rpc.error) throw rpc.error;
    await persistRecoveryFields(result.admin, id, result.row.organization_id, text(commercial.purpose) || "General Purchase", text(commercial.recovery_vendor_id), text(commercial.recovery_work_order_id));
    const purpose = text(commercial.purpose) || "General Purchase";
    if (!PO_PURPOSES.has(purpose)) return jsonError("Purchase Order purpose is invalid.", 400);
    const recoveryWorkOrderId = text(commercial.recovery_work_order_id);
    const recoveryVendorId = text(commercial.recovery_vendor_id);
    if (purpose === "Recover from contractor" && !recoveryVendorId) return jsonError("A recovery contractor is required for contractor recovery Purchase Orders.", 400);
    if (purpose === "Recover from contractor" && !recoveryWorkOrderId) return jsonError("A linked Work Order is required for contractor recovery Purchase Orders.", 400);
    if (purpose === "Recover from contractor" && recoveryWorkOrderId) {
      const recoveryWorkOrder = await result.admin.from("work_orders").select("id,organization_id,company_id,site_id").eq("id", recoveryWorkOrderId).eq("organization_id", result.row.organization_id).eq("company_id", result.row.company_id).eq("site_id", result.row.site_id).maybeSingle();
      if (recoveryWorkOrder.error) throw recoveryWorkOrder.error;
      if (!recoveryWorkOrder.data) return jsonError("The linked Work Order is outside the selected organization/site scope.", 403);
      const vendorLink = await result.admin.from("work_order_vendors").select("id,work_order_id,vendor_id,vendor_role,is_primary").eq("work_order_id", recoveryWorkOrderId).eq("vendor_id", recoveryVendorId).maybeSingle();
      if (vendorLink.error) throw vendorLink.error;
      if (!vendorLink.data || !["Main Contractor", "Subcontractor"].includes(String(vendorLink.data.vendor_role || ""))) return jsonError("The recovery Work Order must be linked to the selected Purchase Order vendor as a main contractor or subcontractor.", 400);
    }
    if (vendorRefresh && vendorRefresh.vendor.id !== result.row.vendor_id) {
      const refreshedVendor = await result.admin.from("procurement_purchase_orders").update(purchaseOrderVendorSnapshotUpdate(requestedVendorId, vendorRefresh.snapshot)).eq("id", id).eq("organization_id", result.row.organization_id).in("status", ["draft", "sent_back"]);
      if (refreshedVendor.error) throw refreshedVendor.error;
    }
    if (Object.prototype.hasOwnProperty.call(commercial, "freight_amount")) { const freightResult = await result.admin.rpc("set_procurement_purchase_order_freight_atomic", { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_freight_amount: Number(commercial.freight_amount || 0), p_actor: actor(result.auth) }); if (freightResult.error) throw new Error(`Purchase Order draft was updated, but Freight could not be saved: ${freightResult.error.message}`); } return NextResponse.json({ result: rpc.data }); } catch (error: any) { const message = error.message || "Failed to save Purchase Order draft."; if (message.includes("The editable item set changed")) { const attempt = request.headers.get("x-po-save-attempt") === "retry" ? "retry" : "initial"; console.warn("[purchase-order-item-set-conflict]", { purchase_order_id: (await context.params).id, attempt }); return NextResponse.json({ error: message, code: "PO_ITEM_SET_CONFLICT" }, { status: 409 }); } return jsonError(message, 500); } }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const hardDelete = text(body.action) === "hard_delete";
    const result = await load(request, id, hardDelete ? "view" : "edit");
    if ("response" in result) return result.response;
    if (hardDelete) {
      if (!result.auth.roleCodes?.includes("platform_owner")) return jsonError("Only a Platform Owner can permanently delete an approved Purchase Order.", 403);
      const rpc = await result.admin.rpc("hard_delete_approved_procurement_purchase_order", { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_confirmation: text(body.confirmation), p_deletion_reason: text(body.deletion_reason), p_test_data_attestation: body.test_data_attestation === true, p_actor: actor(result.auth) });
      if (rpc.error) throw rpc.error;
      if (rpc.data?.deleted !== true) return NextResponse.json({ error: "Purchase Order deletion is blocked by dependent records.", blockers: rpc.data?.blockers || [] }, { status: 409 });
      const cleanupErrors: string[] = [];
      for (const document of rpc.data.documents || []) {
        try { await createPrivateStorageAdapter(result.admin).delete({ bucket: document.storage_bucket, key: document.storage_key }); } catch (error: any) { cleanupErrors.push(`${document.original_file_name || document.storage_key}: ${error.message || "storage deletion failed"}`); }
      }
      if (cleanupErrors.length) return NextResponse.json({ deleted: true, cleanup_pending: true, cleanup_errors: cleanupErrors }, { status: 202 });
      if (rpc.data.audit_id) {
        const auditUpdate = await result.admin.from("deleted_records_audit").update({ file_snapshot: { storage_cleanup_pending: false, documents: rpc.data.documents || [] } }).eq("id", rpc.data.audit_id).eq("organization_id", result.row.organization_id);
        if (auditUpdate.error) return NextResponse.json({ deleted: true, cleanup_pending: true, cleanup_errors: [`Deletion audit could not be finalized: ${auditUpdate.error.message}`] }, { status: 202 });
      }
      return NextResponse.json({ deleted: true });
    }
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
async function createContractorRecoveryDebitNote(result: any, body: any, poId: string) {
  const purpose = text(result.row.purpose || result.row.commercial_snapshot?.purpose) || "General Purchase";
  if (!PO_PURPOSES.has(purpose)) throw new Error("Purchase Order purpose is invalid.");
  if (purpose !== "Recover from contractor") return null;
  const workOrderId = text(result.row.recovery_work_order_id || result.row.commercial_snapshot?.recovery_work_order_id);
  if (!workOrderId) throw new Error("A linked Work Order is required for contractor recovery Purchase Orders.");
  const workOrder = await result.admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number").eq("id", workOrderId).eq("organization_id", result.row.organization_id).eq("company_id", result.row.company_id).eq("site_id", result.row.site_id).maybeSingle();
  if (workOrder.error) throw workOrder.error; if (!workOrder.data) throw new Error("The linked Work Order is not available in this organization.");
  const recoveryVendorId = text(result.row.recovery_vendor_id || result.row.commercial_snapshot?.recovery_vendor_id);
  if (!recoveryVendorId) throw new Error("A recovery contractor is required for contractor recovery Purchase Orders.");
  const vendorLink = await result.admin.from("work_order_vendors").select("id,work_order_id,vendor_id,vendor_role,is_primary").eq("work_order_id", workOrderId).eq("vendor_id", recoveryVendorId).maybeSingle();
  if (vendorLink.error) throw vendorLink.error;
  if (!vendorLink.data || !["Main Contractor", "Subcontractor"].includes(String(vendorLink.data.vendor_role || ""))) throw new Error("The recovery Work Order must be linked to the selected Purchase Order vendor as a main contractor or subcontractor.");
  const documents = await result.admin.from("procurement_purchase_order_documents").select("id,original_file_name,mime_type,size_bytes,storage_bucket,storage_key,document_type").eq("purchase_order_id", poId).eq("organization_id", result.row.organization_id).eq("status", "active").order("sort_order");
  if (documents.error) throw documents.error;
  const existing = await result.admin.from("debit_notes").select("id").eq("organization_id", result.row.organization_id).eq("source_purchase_order_id", poId).or("is_deleted.is.null,is_deleted.eq.false").neq("approval_status", "Rejected").maybeSingle();
  if (existing.error) throw existing.error;
  const basicAmount = Number(result.row.total_basic_amount ?? 0);
  const gstAmount = Number(result.row.total_gst_amount ?? 0);
  const grandTotal = Number(result.row.total_amount ?? 0);
  if (![basicAmount, gstAmount, grandTotal].every(Number.isFinite) || basicAmount < 0 || gstAmount < 0 || grandTotal < 0 || Math.abs((basicAmount + gstAmount) - grandTotal) > 0.005) throw new Error("Purchase Order totals are inconsistent for contractor recovery.");
  let debitNoteId = existing.data?.id || null;
  if (!debitNoteId) {
    const inserted = await result.admin.from("debit_notes").insert({ organization_id: result.row.organization_id, work_order_id: workOrder.data.id, source_purchase_order_id: poId, source_purchase_order_documents: documents.data || [], vendor_id: recoveryVendorId, debit_note_number: `DN-PO-${result.row.po_number}`, debit_note_date: new Date().toISOString().slice(0, 10), debit_note_type: "Contractor Recovery", reason: `Contractor recovery for Purchase Order ${result.row.po_number}. ${text(body.note)}`, gross_amount: basicAmount, gst_amount: gstAmount, total_amount: grandTotal, status: "Draft", approval_status: "Pending", created_by_name: result.auth.user.user_metadata?.full_name || result.auth.user.email, created_by_email: result.auth.user.email }).select("id").single();
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    debitNoteId = inserted.data?.id || null;
    if (!debitNoteId) {
      const raced = await result.admin.from("debit_notes").select("id").eq("organization_id", result.row.organization_id).eq("source_purchase_order_id", poId).or("is_deleted.is.null,is_deleted.eq.false").neq("approval_status", "Rejected").maybeSingle();
      if (raced.error) throw raced.error;
      debitNoteId = raced.data?.id || null;
    }
    if (!debitNoteId) throw new Error("The contractor-recovery Debit Note draft could not be created or recovered safely.");
  }
  const scopedRecipients = new Set(await resolveNotificationRecipients(result.admin, { organizationId: result.row.organization_id, companyId: workOrder.data.company_id, siteId: workOrder.data.site_id, moduleCode: "debit_notes", actionCode: "view" }));
  for (const recipientUserId of scopedRecipients) { await insertNotificationOnce(result.admin, { organization_id: result.row.organization_id, recipient_user_id: recipientUserId, notification_type: "contractor_recovery_debit_note", title: "Contractor recovery Debit Note draft", message: `Debit Note draft for Purchase Order ${result.row.po_number} is ready for review.`, target_url: `/debit-notes/${debitNoteId}`, related_entity_type: "debit_note", related_entity_id: debitNoteId }); }
  return debitNoteId;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const body = await request.json().catch(() => ({})); const action = text(body.action); const requiredAction = action === "approve" ? "approve" : action === "send_back" || action === "reject" ? "reject" : action === "issue" ? "issue" : "edit"; const result = await load(request, id, requiredAction); if ("response" in result) return result.response;
  if (action === "send_back" || action === "reject") {
    if (!text(body.note)) return jsonError("A reason is required for this action.", 400);
  }
  if (action === "submit") {
    const purpose = text(result.row.purpose || result.row.commercial_snapshot?.purpose) || "General Purchase";
    if (!PO_PURPOSES.has(purpose)) return jsonError("Purchase Order purpose is invalid.", 400);
    if (purpose === "Recover from contractor" && !text(result.row.recovery_work_order_id || result.row.commercial_snapshot?.recovery_work_order_id)) return jsonError("A linked Work Order is required for contractor recovery Purchase Orders.", 400);
    if (purpose === "Recover from contractor") {
      const recoveryWorkOrderId = text(result.row.recovery_work_order_id || result.row.commercial_snapshot?.recovery_work_order_id);
      const recoveryWorkOrder = await result.admin.from("work_orders").select("id").eq("id", recoveryWorkOrderId).eq("organization_id", result.row.organization_id).eq("company_id", result.row.company_id).eq("site_id", result.row.site_id).maybeSingle();
      if (recoveryWorkOrder.error) throw recoveryWorkOrder.error;
      if (!recoveryWorkOrder.data) return jsonError("The linked Work Order is outside the selected organization/site scope.", 403);
      const vendorLink = await result.admin.from("work_order_vendors").select("id,work_order_id,vendor_id,vendor_role,is_primary").eq("work_order_id", recoveryWorkOrderId).eq("vendor_id", result.row.vendor_id).maybeSingle();
      if (vendorLink.error) throw vendorLink.error;
      if (!vendorLink.data || !["Main Contractor", "Subcontractor"].includes(String(vendorLink.data.vendor_role || ""))) return jsonError("The recovery Work Order must be linked to the selected Purchase Order vendor as a main contractor or subcontractor.", 400);
    }
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
  const rpc = await result.admin.rpc("transition_procurement_purchase_order_atomic", { p_purchase_order_id: id, p_organization_id: result.row.organization_id, p_action: action, p_actor: actor(result.auth), p_note: text(body.note) || null }); if (rpc.error) throw rpc.error; const recoveryDebitNoteId = action === "submit" || action === "approve" ? await createContractorRecoveryDebitNote(result, body, id) : null; return NextResponse.json({ result: rpc.data, contractor_recovery_debit_note_id: recoveryDebitNoteId }); } catch (error: any) { return jsonError(error.message || "Failed to update Purchase Order workflow.", 500); } }
