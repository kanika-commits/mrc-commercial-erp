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
} from "../../../_shared";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "upload");
    if ("response" in auth) return auth.response;

    const { id, docId } = await context.params;
    const admin = adminClient();
    const claimResult = await loadClaimForAccess(admin, auth, id);

    if ("error" in claimResult) {
      return jsonError(claimResult.error || "You do not have access to this reimbursement claim.", claimResult.status || 403);
    }

    const { claim } = claimResult;
    if (!isEditableClaim(claim)) {
      return jsonError("Documents can be deleted only for draft or rejected claims.", 409);
    }

    const { data: document, error: documentError } = await admin
      .from("reimbursement_documents")
      .select("id, organization_id, reimbursement_claim_id, file_url, file_path")
      .eq("id", docId)
      .eq("reimbursement_claim_id", id)
      .maybeSingle();

    if (documentError) throw documentError;

    if (!document) {
      return jsonError("Reimbursement document was not found.", 404);
    }

    if (document.organization_id !== claim.organization_id) {
      return jsonError("You do not have access to this document.", 403);
    }

    const path = normalizeStoragePath(document.file_path || document.file_url);
    if (path) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    }

    const { error } = await admin
      .from("reimbursement_documents")
      .delete()
      .eq("id", docId)
      .eq("reimbursement_claim_id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete reimbursement document.", 500);
  }
}
