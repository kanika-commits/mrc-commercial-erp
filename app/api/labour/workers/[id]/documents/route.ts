import { NextResponse } from "next/server";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import {
  actorFields,
  audit,
  jsonError,
  LABOUR_DOCUMENT_BUCKET,
  loadScopedWorker,
  requireLabourPermission,
} from "@/app/api/labour/_shared";
import { LABOUR_DOCUMENT_TYPES, normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_documents", "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const documentId = new URL(request.url).searchParams.get("document_id");
    if (documentId) {
      const { data: document, error } = await access.admin
        .from("labour_documents")
        .select("*")
        .eq("id", documentId)
        .eq("labour_worker_id", id)
        .maybeSingle();
      if (error) throw error;
      if (!document) return jsonError("Document not found.", 404);
      if (document.storage_provider === "google_drive" && document.source_url) {
        return NextResponse.json({ url: document.source_url });
      }
      const url = await createPrivateStorageAdapter(access.admin).createSignedReadUrl({
        bucket: document.storage_bucket,
        key: document.storage_key,
      });
      return NextResponse.json({ url });
    }
    const { data, error } = await access.admin
      .from("labour_documents")
      .select("id, document_type, document_name, document_number, issue_date, expiry_date, version, is_active, original_file_name, mime_type, size_bytes, uploaded_at, uploaded_by_name")
      .eq("labour_worker_id", id)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ documents: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour documents.", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let stored: { bucket: string; key: string } | null = null;
  try {
    const access = await requireLabourPermission(request, "labour_workers", "upload");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const formData = await request.formData();
    const file = formData.get("file");
    const documentType = text(formData.get("document_type"));
    if (!(file instanceof File)) return jsonError("Document file is required.");
    if (!documentType || !LABOUR_DOCUMENT_TYPES.includes(documentType as any)) return jsonError("Valid document type is required.");

    const { data: activeRows, error: activeError } = await access.admin
      .from("labour_documents")
      .select("id, version")
      .eq("labour_worker_id", id)
      .eq("document_type", documentType)
      .eq("is_active", true)
      .order("version", { ascending: false });
    if (activeError) throw activeError;
    const nextVersion = Math.max(0, ...(activeRows || []).map((row: any) => Number(row.version) || 0)) + 1;
    const key = safeObjectKey([worker.organization_id, id, documentType, `${Date.now()}-${file.name}`]);
    const adapter = createPrivateStorageAdapter(access.admin);
    const object = await adapter.upload({ bucket: LABOUR_DOCUMENT_BUCKET, key, file });
    stored = { bucket: object.bucket, key: object.key };

    const insertPayload = {
      organization_id: worker.organization_id,
      labour_worker_id: id,
      document_type: documentType,
      document_name: text(formData.get("document_name")) || documentType,
      document_number: text(formData.get("document_number")),
      issue_date: text(formData.get("issue_date")),
      expiry_date: text(formData.get("expiry_date")),
      version: nextVersion,
      is_active: true,
      storage_provider: object.provider,
      storage_bucket: object.bucket,
      storage_key: object.key,
      original_file_name: object.originalFileName,
      mime_type: object.mimeType,
      size_bytes: object.sizeBytes,
      checksum: object.checksum,
      source_type: "manual",
      ...actorFields(access.auth, "uploaded"),
    };

    const { data, error } = await access.admin.from("labour_documents").insert(insertPayload).select("id").single();
    if (error) throw error;
    if (activeRows?.length) {
      const { error: deactivateError } = await access.admin
        .from("labour_documents")
        .update({ is_active: false, replaced_by_document_id: data.id, updated_at: new Date().toISOString() })
        .in("id", activeRows.map((row: any) => row.id));
      if (deactivateError) throw deactivateError;
    }
    stored = null;
    await audit(access, request, {
      moduleCode: "labour_documents",
      action: nextVersion > 1 ? "document_replace" : "document_upload",
      entityType: "labour_document",
      recordId: data.id,
      parentEntityType: "labour_worker",
      parentRecordId: id,
      organizationId: worker.organization_id,
      companyId: worker.current_company_id,
      siteId: worker.current_site_id,
      description: `Uploaded ${documentType}.`,
      newValues: { document_type: documentType, version: nextVersion, file_name: object.originalFileName },
    } as any);
    return NextResponse.json({ document_id: data.id });
  } catch (error: any) {
    if (stored) {
      try {
        const access = await requireLabourPermission(request, "labour_documents", "upload");
        if (!("response" in access)) await createPrivateStorageAdapter(access.admin).delete(stored);
      } catch {}
    }
    return jsonError(error.message || "Failed to upload labour document.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_documents", "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const documentId = new URL(request.url).searchParams.get("document_id");
    if (!documentId) return jsonError("Document ID is required.");
    const { data: document, error } = await access.admin.from("labour_documents").select("*").eq("id", documentId).eq("labour_worker_id", id).maybeSingle();
    if (error) throw error;
    if (!document) return jsonError("Document not found.", 404);
    await createPrivateStorageAdapter(access.admin).delete({ bucket: document.storage_bucket, key: document.storage_key });
    const { error: deleteError } = await access.admin.from("labour_documents").delete().eq("id", documentId);
    if (deleteError) throw deleteError;
    await audit(access, request, {
      moduleCode: "labour_documents",
      action: "document_delete",
      entityType: "labour_document",
      recordId: documentId,
      parentEntityType: "labour_worker",
      parentRecordId: id,
      organizationId: worker.organization_id,
      companyId: worker.current_company_id,
      siteId: worker.current_site_id,
      description: `Deleted ${document.document_type}.`,
      oldValues: { document_type: document.document_type, version: document.version },
    } as any);
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete labour document.", 500);
  }
}
