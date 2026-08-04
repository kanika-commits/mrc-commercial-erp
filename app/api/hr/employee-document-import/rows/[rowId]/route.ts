import { NextResponse } from "next/server";
import { actorName, adminClient, jsonError, loadScopedImportRow, requireDocumentImportPermission } from "../../_shared";

type RouteParams = {
  params: Promise<{ rowId: string }>;
};

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireDocumentImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const { rowId } = await params;
    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    const selectedAction = String(payload.selected_action || "").trim();
    if (!batchId) return jsonError("batch_id is required.");
    if (!rowId) return jsonError("row id is required.");
    if (!["pending", "skip", "new_version"].includes(selectedAction)) {
      return jsonError("Select a valid row action.");
    }

    const admin = adminClient();
    const rowResult = await loadScopedImportRow(admin, rowId, batchId, auth);
    if ("response" in rowResult && rowResult.response) return rowResult.response;
    if (!("row" in rowResult)) return jsonError("Document import row was not found.", 404);
    if (rowResult.row.execution_status === "imported") {
      return jsonError("Imported rows cannot be changed.", 409);
    }

    const { data: row, error } = await admin
      .from("employee_document_import_rows")
      .update({
        selected_action: selectedAction,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId)
      .eq("batch_id", batchId)
      .select("*")
      .single();
    if (error) throw error;

    await admin
      .from("employee_document_import_batches")
      .update({
        updated_by: auth.user.id,
        updated_by_name: actorName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    return NextResponse.json({ row });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update employee document import row.", 500);
  }
}
