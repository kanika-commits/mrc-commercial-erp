import { NextResponse } from "next/server";
import { jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";

export async function PATCH(request: Request, context: { params: Promise<{ rowId: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "upload");
    if ("response" in access) return access.response;
    const { rowId } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const { data: row, error: rowError } = await access.admin
      .from("labour_attendance_import_rows")
      .select("id, batch_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return jsonError("Import row not found.", 404);
    const batch = await loadScopedAttendanceImportBatch(access, row.batch_id);
    if (!batch) return jsonError("Import row not found.", 404);
    const selectedAction = payload.selected_action === "skip" ? "skip" : "import";
    const { error } = await access.admin.from("labour_attendance_import_rows").update({
      selected_action: selectedAction,
      execution_status: selectedAction === "skip" ? "skipped" : "pending",
      updated_at: new Date().toISOString(),
    }).eq("id", rowId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update attendance import row.", 500);
  }
}
