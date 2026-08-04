import { NextResponse } from "next/server";
import { jsonError, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";

export async function PATCH(request: Request, context: { params: Promise<{ rowId: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const { rowId } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const { data: row, error: rowError } = await access.admin.from("labour_import_rows").select("id, batch_id, organization_id, normalized_data").eq("id", rowId).maybeSingle();
    if (rowError) throw rowError;
    if (!row) return jsonError("Import row not found.", 404);
    const batch = await loadScopedLabourImportBatch(access, row.batch_id);
    if (!batch) return jsonError("Import row not found.", 404);
    const normalized = { ...(row.normalized_data || {}), ...(payload.normalized_data || {}) };
    const selectedAction = normalizeText(payload.selected_action);
    const update: Record<string, any> = { normalized_data: normalized, updated_at: new Date().toISOString() };
    if (selectedAction) update.selected_action = selectedAction;
    const { error } = await access.admin.from("labour_import_rows").update(update).eq("id", rowId);
    if (error) throw error;
    return NextResponse.json({ row_id: rowId });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labour import row.", 500);
  }
}
