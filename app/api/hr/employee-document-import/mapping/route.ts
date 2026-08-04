import { NextResponse } from "next/server";
import { actorName, adminClient, jsonError, loadScopedBatch, requireDocumentImportPermission, validateRowsForBatch } from "../_shared";

export async function PUT(request: Request) {
  try {
    const auth = await requireDocumentImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadScopedBatch(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;

    const { data: batch, error } = await admin
      .from("employee_document_import_batches")
      .update({
        mapping: payload.mapping || batchResult.batch.mapping || {},
        updated_by: auth.user.id,
        updated_by_name: actorName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select("*")
      .single();
    if (error) throw error;

    const result = await validateRowsForBatch(admin, batch);
    return NextResponse.json(result);
  } catch (error: any) {
    return jsonError(error.message || "Failed to update employee document import mapping.", 500);
  }
}
