import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, APPROVAL_MODULE, jsonError, REQUISITION_MODULE, requireProcurementAny, requireProcurementPermission, canProcurement, text } from "@/lib/serverProcurementAccess";

const BUCKET = "purchase-requisition-documents";

async function loadRequisition(admin: any, auth: any, id: string) {
  let query = applyOrganizationAccess(admin.from("purchase_requisitions").select("id, organization_id, company_id, site_id, requisition_number, status, current_approval_layer, approval_workflow_version").eq("id", id).maybeSingle(), auth);
  if (!query) return null;
  query = applyCompanySiteAccess(query, auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function assertApprovalApprover(admin: any, auth: any, row: any) {
  if (row.status !== "pending_approval") return false;
  const { data, error } = await admin.from("purchase_requisition_approval_steps").select("approver_user_id, status, submission_cycle, layer_number").eq("requisition_id", row.id).eq("workflow_version", row.approval_workflow_version).order("submission_cycle", { ascending: false });
  if (error) throw error;
  const latest = Math.max(0, ...(data || []).map((step: any) => Number(step.submission_cycle || 0)));
  const current = (data || []).find((step: any) => Number(step.submission_cycle) === latest && Number(step.layer_number) === row.current_approval_layer);
  return Boolean(current && current.status === "pending" && current.approver_user_id === auth.user.id);
}

async function assertLineApprovalApprover(admin: any, auth: any, row: any, lineKey: string) {
  if (row.status !== "pending_approval" || !lineKey) return false;
  const { data: state, error: stateError } = await admin.from("purchase_requisition_line_approval_state").select("workflow_version, submission_cycle, current_approval_layer, approval_status").eq("requisition_id", row.id).eq("requisition_item_line_key", lineKey).maybeSingle();
  if (stateError) throw stateError;
  if (!state || state.approval_status !== "pending") return false;
  const { data: step, error: stepError } = await admin.from("purchase_requisition_line_approval_steps").select("approver_user_id, status").eq("requisition_id", row.id).eq("requisition_item_line_key", lineKey).eq("workflow_version", state.workflow_version).eq("submission_cycle", state.submission_cycle).eq("layer_number", state.current_approval_layer).maybeSingle();
  if (stepError) throw stepError;
  return Boolean(step?.status === "pending" && step.approver_user_id === auth.user.id);
}

async function authorization(request: Request, id: string, mutation: boolean) {
  const auth = await requireProcurementAny(request, [{ moduleCode: REQUISITION_MODULE, actionCode: "view" }, { moduleCode: REQUISITION_MODULE, actionCode: "edit" }, { moduleCode: REQUISITION_MODULE, actionCode: "add" }, { moduleCode: APPROVAL_MODULE, actionCode: "approve" }]);
  if ("response" in auth) return { response: auth.response } as const;
  const admin = adminClient();
  const row = await loadRequisition(admin, auth, id);
  if (!row) return { response: jsonError("Requisition was not found.", 404) } as const;
  if (!mutation) return { auth, admin, row } as const;
  const { count: lineStateCount, error: lineStateError } = await admin.from("purchase_requisition_line_approval_state").select("requisition_item_line_key", { count: "exact", head: true }).eq("requisition_id", row.id);
  if (lineStateError) throw lineStateError;
  if (lineStateCount && lineStateCount > 0) return { auth, admin, row, lineWorkflowInitialized: true } as const;
  const approver = await assertApprovalApprover(admin, auth, row);
  const allowed = row.status === "pending_approval" ? approver && canProcurement(auth, APPROVAL_MODULE, "approve") : ["draft", "sent_back"].includes(row.status) && (canProcurement(auth, REQUISITION_MODULE, "edit") || canProcurement(auth, REQUISITION_MODULE, "add"));
  if (!allowed) return { response: jsonError("You are not authorized to modify attachments for this requisition.", 403) } as const;
  return { auth, admin, row } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await authorization(request, id, false);
    if ("response" in result) return result.response;
    const documentId = new URL(request.url).searchParams.get("document_id");
    if (documentId) {
      const { data: document, error } = await result.admin.from("purchase_requisition_documents").select("*").eq("id", documentId).eq("requisition_id", id).eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!document) return jsonError("Attachment was not found.", 404);
      const url = await createPrivateStorageAdapter(result.admin).createSignedReadUrl({ bucket: document.storage_bucket, key: document.storage_key });
      return NextResponse.json({ url });
    }
    const { data, error } = await result.admin.from("purchase_requisition_documents").select("id, requisition_id, requisition_item_line_key, original_file_name, mime_type, size_bytes, uploaded_by_name, uploaded_by_email, uploaded_at, status").eq("requisition_id", id).eq("status", "active").order("uploaded_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ documents: data || [] });
  } catch (error: any) { return jsonError(error.message || "Failed to load requisition attachments.", 500); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let stored: { bucket: string; key: string } | null = null;
  try {
    const { id } = await context.params;
    const result = await authorization(request, id, true);
    if ("response" in result) return result.response;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Attachment file is required.", 400);
    const lineKey = text(form.get("line_key"));
    if (result.lineWorkflowInitialized) {
      if (!lineKey || !(await assertLineApprovalApprover(result.admin, result.auth, result.row, lineKey)) || !canProcurement(result.auth, APPROVAL_MODULE, "approve")) return jsonError("You are not authorized to modify this material line attachment.", 403);
    } else if (lineKey) {
      const { data: line, error: lineError } = await result.admin.from("purchase_requisition_items").select("line_key").eq("requisition_id", result.row.id).eq("line_key", lineKey).maybeSingle();
      if (lineError) throw lineError;
      if (!line) return jsonError("Material line was not found on this requisition.", 400);
    }
    const object = await createPrivateStorageAdapter(result.admin).upload({ bucket: BUCKET, key: safeObjectKey(lineKey ? [result.row.organization_id, result.row.id, lineKey, `${crypto.randomUUID()}-${file.name}`] : [result.row.organization_id, result.row.id, `${crypto.randomUUID()}-${file.name}`]), file });
    stored = { bucket: object.bucket, key: object.key };
    const actorName = text(result.auth.user.user_metadata?.full_name || result.auth.user.email);
    const { data: document, error } = await result.admin.rpc("add_purchase_requisition_document_atomic", {
      p_requisition_id: id,
      p_organization_id: result.row.organization_id,
      p_document: {
        requisition_item_line_key: lineKey || null,
        storage_provider: object.provider,
        storage_bucket: object.bucket,
        storage_key: object.key,
        original_file_name: object.originalFileName,
        mime_type: object.mimeType,
        size_bytes: object.sizeBytes,
        checksum: object.checksum,
      },
      p_actor: { user_id: result.auth.user.id, name: actorName, email: result.auth.user.email || null },
    });
    if (error) throw error;
    try { await recordAuditEvent(result.admin, result.auth.user, { organizationId: result.row.organization_id, companyId: result.row.company_id, siteId: result.row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: result.row.requisition_number, action: "upload", actionCategory: "workflow", activityLabel: "Added Indent Attachment", description: `Added attachment to purchase requisition ${result.row.requisition_number}.` }, request); } catch (auditError) { console.error("[Procurement Audit] Attachment upload audit failed", auditError); }
    return NextResponse.json({ document });
  } catch (error: any) {
    if (stored) { try { await createPrivateStorageAdapter(adminClient()).delete(stored); } catch {} }
    return jsonError(error.message || "Failed to upload requisition attachment.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await authorization(request, id, true);
    if ("response" in result) return result.response;
    const params = new URL(request.url).searchParams;
    const documentId = params.get("document_id");
    if (!documentId) return jsonError("Attachment id is required.", 400);
    const cleanup = params.get("cleanup") === "1";
    const { data: document, error } = await result.admin.from("purchase_requisition_documents").select("*").eq("id", documentId).eq("requisition_id", id).in("status", cleanup ? ["active", "deleted"] : ["active"]).maybeSingle();
    if (error) throw error;
    if (!document) return jsonError("Attachment was not found.", 404);
    if (result.lineWorkflowInitialized && (!document.requisition_item_line_key || !(await assertLineApprovalApprover(result.admin, result.auth, result.row, document.requisition_item_line_key)) || !canProcurement(result.auth, APPROVAL_MODULE, "approve"))) return jsonError("You are not authorized to modify this material line attachment.", 403);
    const actorName = text(result.auth.user.user_metadata?.full_name || result.auth.user.email);
    const { error: removeError } = await result.admin.rpc("remove_purchase_requisition_document_atomic", { p_requisition_id: id, p_organization_id: result.row.organization_id, p_document_id: document.id, p_actor: { user_id: result.auth.user.id, name: actorName, email: result.auth.user.email || null } });
    if (removeError) throw removeError;
    try {
      await createPrivateStorageAdapter(result.admin).delete({ bucket: document.storage_bucket, key: document.storage_key });
    } catch (storageError: any) {
      return jsonError(storageError.message || "Attachment metadata was removed, but storage cleanup failed.", 500);
    }
    try { await recordAuditEvent(result.admin, result.auth.user, { organizationId: result.row.organization_id, companyId: result.row.company_id, siteId: result.row.site_id, moduleCode: APPROVAL_MODULE, entityType: "purchase_requisition", recordId: id, recordNumber: result.row.requisition_number, action: "delete", actionCategory: "workflow", activityLabel: "Removed Indent Attachment", description: `Removed attachment from purchase requisition ${result.row.requisition_number}.` }, request); } catch (auditError) { console.error("[Procurement Audit] Attachment removal audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error: any) { return jsonError(error.message || "Failed to remove requisition attachment.", 500); }
}
