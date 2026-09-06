import { NextResponse } from "next/server";
import {
  adminClient,
  applyCompanySiteAccess,
  applyOrganizationAccess,
  jsonError,
  requireProcurementAny,
  requireProcurementPermission,
  text,
} from "@/lib/serverProcurementAccess";
import { createPrivateStorageAdapter, safeObjectKey, type StoredObject } from "@/lib/storage/privateStorage";
import { loadFrozenSupportingDocuments } from "@/lib/procurement/poSupportingDocumentIntegrity";

const MODULE = "procurement_purchase_orders";
const DOCUMENT_BUCKET = "procurement-rfq-quotation-documents";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PACKAGE_SIZE = 25 * 1024 * 1024;
const VENDOR_ACCEPTANCE_STATUSES = new Set(["approved", "issued"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);
const SIGNED_PO_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_DOCUMENT_TYPES = new Set([
  "technical_document",
  "commercial_document",
  "approval_support",
  "signed_po",
  "other",
]);

async function loadPurchaseOrder(request: Request, id: string, action: "view" | "edit") {
  const auth = action === "view"
    ? await requireProcurementAny(request, [
        { moduleCode: MODULE, actionCode: "view" },
        { moduleCode: MODULE, actionCode: "edit" },
        { moduleCode: MODULE, actionCode: "approve" },
        { moduleCode: MODULE, actionCode: "issue" },
      ])
    : await requireProcurementPermission(request, MODULE, "edit");
  if ("response" in auth) return { response: auth.response } as const;

  const admin = adminClient();
  let query: any = applyOrganizationAccess(
    admin.from("procurement_purchase_orders").select("id, organization_id, company_id, site_id, status, supporting_documents_manifest").eq("id", id).maybeSingle(),
    auth,
  );
  query = query && applyCompanySiteAccess(query, auth);
  if (!query) return { response: jsonError("Purchase Order was not found.", 404) } as const;
  const { data: row, error } = await query;
  if (error) throw error;
  if (!row) return { response: jsonError("Purchase Order was not found.", 404) } as const;
  return { auth, admin, row } as const;
}

function validFile(file: File) {
  if (!file || file.size === 0) return "A document file is required.";
  if (file.size > MAX_FILE_SIZE) return "Each attachment must be 20 MB or smaller.";
  if (!ALLOWED_MIME_TYPES.has(file.type)) return "This file type is not supported for Purchase Order attachments.";
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await loadPurchaseOrder(request, id, "view");
    if ("response" in access) return access.response;
    const frozen = await loadFrozenSupportingDocuments(access.admin, access.row);
    if (frozen.integrityError) return NextResponse.json({ error: frozen.integrityError, package_integrity_error: true }, { status: 409 });
    const orderedDocuments = frozen.documents;
    const storage = createPrivateStorageAdapter(access.admin);
    const documents = await Promise.all(orderedDocuments.map(async (document: any) => ({
      id: document.id,
      purchase_order_id: id,
      document_type: document.document_type || "other",
      original_file_name: document.original_file_name,
      mime_type: document.mime_type,
      size_bytes: document.size_bytes,
      status: document.status || "active",
      sort_order: document.sort_order,
      created_by_name: document.created_by_name,
      created_by_email: document.created_by_email,
      created_at: document.created_at,
      included_in_pdf: document.included_in_pdf === true,
      signed_url: document.storage_bucket && document.storage_key ? await storage.createSignedReadUrl({ bucket: document.storage_bucket, key: document.storage_key }) : null,
    })));
    return NextResponse.json({ documents });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Purchase Order attachments.", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let stored: StoredObject | null = null;
  try {
    const { id } = await context.params;
    const access = await loadPurchaseOrder(request, id, "edit");
    if ("response" in access) return access.response;
    const form = await request.formData();
    const requestedType = text(form.get("document_type")) || "other";
    const documentType = ALLOWED_DOCUMENT_TYPES.has(requestedType) ? requestedType : "other";
    if (documentType === "signed_po" && !VENDOR_ACCEPTANCE_STATUSES.has(access.row.status)) return jsonError("Vendor Acceptance documents can only be added to Approved or Issued Purchase Orders.", 403);
    if (documentType !== "signed_po" && access.row.status !== "draft") return jsonError("Attachments can only be added while the Purchase Order is Draft.", 403);
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("A document file is required.", 400);
    const fileError = validFile(file);
    if (fileError) return jsonError(fileError, 400);
    if (documentType === "signed_po" && !SIGNED_PO_MIME_TYPES.has(file.type)) return jsonError("Vendor Acceptance must be a PDF, JPG, PNG or WEBP file.", 400);
    const { data: existing, error: existingError } = await access.admin.from("procurement_purchase_order_documents").select("id,document_type,storage_bucket,storage_key,sort_order").eq("purchase_order_id", id).eq("organization_id", access.row.organization_id).eq("status", "active");
    if (existingError) throw existingError;
    const requestedOrder = Number(form.get("sort_order"));
    const sortOrder = Number.isInteger(requestedOrder) && requestedOrder >= 0 ? requestedOrder : (existing || []).reduce((max: number, item: any) => Math.max(max, Number.isInteger(item.sort_order) ? item.sort_order : -1), -1) + 1;
    const key = safeObjectKey([access.row.organization_id, "purchase-orders", id, `${Date.now()}-${file.name}`]);
    const storage = createPrivateStorageAdapter(access.admin);
    stored = await storage.upload({ bucket: DOCUMENT_BUCKET, key, file });
    const documentPayload = { document_type: documentType, original_file_name: file.name, storage_provider: stored.provider, storage_bucket: stored.bucket, storage_key: stored.key, mime_type: stored.mimeType, size_bytes: stored.sizeBytes, sort_order: sortOrder, created_by: access.auth.user.id, created_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.email || "User", created_by_email: access.auth.user.email || null };
    const documentResult = documentType === "signed_po"
      ? await access.admin.from("procurement_purchase_order_documents").insert({ organization_id: access.row.organization_id, purchase_order_id: id, ...documentPayload }).select("id,purchase_order_id,document_type,original_file_name,mime_type,size_bytes,status,sort_order,created_by_name,created_at").single()
      : await access.admin.rpc("add_procurement_purchase_order_document_atomic", { p_purchase_order_id: id, p_organization_id: access.row.organization_id, p_document: documentPayload });
    if (documentResult.error) throw documentResult.error;
    if (documentType === "signed_po") {
      const previous = (existing || []).filter((document: any) => document.document_type === "signed_po");
      if (previous.length) {
        const { error: replaceError } = await access.admin.from("procurement_purchase_order_documents").update({ status: "deleted" }).in("id", previous.map((document: any) => document.id)).eq("organization_id", access.row.organization_id);
        if (replaceError) throw replaceError;
        for (const document of previous) {
          if (document.storage_bucket && document.storage_key) await storage.delete({ bucket: document.storage_bucket, key: document.storage_key });
        }
      }
    }
    return NextResponse.json({ document: documentResult.data }, { status: 201 });
  } catch (error: any) {
    if (stored) {
      try { await createPrivateStorageAdapter(adminClient()).delete(stored); } catch { /* preserve the original upload error */ }
    }
    return jsonError(error.message || "Failed to upload Purchase Order attachment.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await loadPurchaseOrder(request, id, "edit");
    if ("response" in access) return access.response;
    if (access.row.status !== "draft") return jsonError("Attachments cannot be removed after the Purchase Order leaves Draft.", 403);
    const documentId = new URL(request.url).searchParams.get("document_id")?.trim();
    if (!documentId) return jsonError("Document ID is required.", 400);
    const { data: document, error } = await access.admin.rpc("remove_procurement_purchase_order_document_atomic", { p_purchase_order_id: id, p_organization_id: access.row.organization_id, p_document_id: documentId });
    if (error) throw error;
    await createPrivateStorageAdapter(access.admin).delete({ bucket: document.storage_bucket, key: document.storage_key });
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete Purchase Order attachment.", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await loadPurchaseOrder(request, id, "edit");
    if ("response" in access) return access.response;
    if (access.row.status !== "draft") return jsonError("Attachments can only be reordered while the Purchase Order is Draft.", 403);
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.document_ids) ? body.document_ids.filter((value: unknown) => typeof value === "string") : [];
    const { error } = await access.admin.rpc("reorder_procurement_purchase_order_documents_atomic", { p_purchase_order_id: id, p_organization_id: access.row.organization_id, p_document_ids: ids });
    if (error) throw error;
    return NextResponse.json({ reordered: true });
  } catch (error: any) { return jsonError(error.message || "Failed to reorder Purchase Order attachments.", 500); }
}
