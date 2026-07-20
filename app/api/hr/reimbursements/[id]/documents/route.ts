import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  adminClient,
  DOCUMENT_BUCKET,
  isEditableClaim,
  jsonError,
  loadClaimForAccess,
  MODULE_CODE,
  normalizeStoragePath,
  userName,
} from "../../_shared";

const MAX_FILES_PER_CLAIM = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function safeFileName(value: string) {
  return String(value || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "document";
}

async function signedDocument(admin: ReturnType<typeof adminClient>, document: any) {
  const path = normalizeStoragePath(document.file_path || document.file_url);
  let signed_url: string | null = null;
  let signed_url_error: string | null = null;

  if (path) {
    const { data, error } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(path, 60 * 10);

    signed_url = data?.signedUrl || null;
    signed_url_error = error?.message || null;
  }

  return {
    id: document.id,
    reimbursement_claim_id: document.reimbursement_claim_id,
    document_type: document.document_type,
    file_name: document.file_name,
    mime_type: document.mime_type,
    uploaded_at: document.uploaded_at,
    uploaded_by_name: document.uploaded_by_name,
    uploaded_by_email: document.uploaded_by_email,
    signed_url,
    signed_url_error,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const claimResult = await loadClaimForAccess(admin, auth, id);

    if ("error" in claimResult) {
      return jsonError(claimResult.error || "You do not have access to this reimbursement claim.", claimResult.status || 403);
    }

    const { data, error } = await admin
      .from("reimbursement_documents")
      .select("id, reimbursement_claim_id, document_type, file_name, file_url, file_path, mime_type, uploaded_by_name, uploaded_by_email, uploaded_at")
      .eq("reimbursement_claim_id", id)
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    const documents = await Promise.all((data || []).map((doc) => signedDocument(admin, doc)));
    return NextResponse.json({ documents });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load reimbursement documents.", 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "upload");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const claimResult = await loadClaimForAccess(admin, auth, id);

    if ("error" in claimResult) {
      return jsonError(claimResult.error || "You do not have access to this reimbursement claim.", claimResult.status || 403);
    }

    const { claim } = claimResult;
    if (!isEditableClaim(claim)) {
      return jsonError("Documents can be uploaded only for draft or rejected claims.", 409);
    }

    const { count, error: countError } = await admin
      .from("reimbursement_documents")
      .select("id", { count: "exact", head: true })
      .eq("reimbursement_claim_id", id);

    if (countError) throw countError;

    const formData = await request.formData();
    const documentType = String(formData.get("document_type") || "supporting_document").trim();
    const files = formData
      .getAll("files")
      .concat(formData.getAll("file"))
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      return jsonError("At least one document file is required.", 400);
    }

    if ((count || 0) + files.length > MAX_FILES_PER_CLAIM) {
      return jsonError("A reimbursement claim can have a maximum of 10 documents.", 409);
    }

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return jsonError("Only JPEG, PNG, WEBP, and PDF files are allowed.", 400);
      }

      if (file.size > MAX_FILE_SIZE) {
        return jsonError("Each reimbursement document must be 10MB or smaller.", 400);
      }
    }

    const insertedDocuments: any[] = [];
    const uploadedPaths: string[] = [];

    try {
      for (const file of files) {
        const fileName = safeFileName(file.name);
        const path = `${claim.organization_id}/${id}/${Date.now()}-${crypto.randomUUID()}-${fileName}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { error: uploadError } = await admin.storage
          .from(DOCUMENT_BUCKET)
          .upload(path, buffer, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;
        uploadedPaths.push(path);

        const { data: document, error: insertError } = await admin
          .from("reimbursement_documents")
          .insert({
            organization_id: claim.organization_id,
            reimbursement_claim_id: id,
            document_type: documentType,
            file_name: fileName,
            file_url: path,
            file_path: path,
            mime_type: file.type,
            uploaded_by: auth.user.id,
            uploaded_by_name: userName(auth),
            uploaded_by_email: auth.user.email || null,
          })
          .select("id, reimbursement_claim_id, document_type, file_name, file_url, file_path, mime_type, uploaded_by_name, uploaded_by_email, uploaded_at")
          .single();

        if (insertError) throw insertError;
        insertedDocuments.push(document);
      }
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await admin.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths);
      }
      throw error;
    }

    const documents = await Promise.all(
      insertedDocuments.map((doc) => signedDocument(admin, doc))
    );

    return NextResponse.json({ documents });
  } catch (error: any) {
    return jsonError(error.message || "Failed to upload reimbursement documents.", 500);
  }
}
