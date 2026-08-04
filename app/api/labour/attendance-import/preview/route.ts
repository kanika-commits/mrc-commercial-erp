import { NextResponse } from "next/server";
import { jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { loadBatchRows, loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "view");
    if ("response" in access) return access.response;
    const batchId = new URL(request.url).searchParams.get("batch_id");
    if (!batchId) return jsonError("Batch ID is required.");
    const batch = await loadScopedAttendanceImportBatch(access, batchId);
    if (!batch) return jsonError("Import batch not found.", 404);
    const rows = await loadBatchRows(access, batchId);
    return NextResponse.json({ batch, rows });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load attendance import preview.", 500);
  }
}
