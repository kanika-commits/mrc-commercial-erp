import { NextResponse } from "next/server";
import { jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";

export async function PATCH(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "upload");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    if (!payload.batch_id) return jsonError("Batch ID is required.");
    const batch = await loadScopedAttendanceImportBatch(access, payload.batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);
    const { error } = await access.admin.from("labour_attendance_import_batches").update({
      mapping: payload.mapping && typeof payload.mapping === "object" ? payload.mapping : {},
      updated_at: new Date().toISOString(),
    }).eq("id", payload.batch_id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update attendance import mapping.", 500);
  }
}
