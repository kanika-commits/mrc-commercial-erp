import { NextResponse } from "next/server";
import { csvEscape } from "@/lib/labour/constants";
import { jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { loadBatchRows, loadScopedAttendanceImportBatch } from "@/app/api/labour/attendance-import/_shared";

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "export");
    if ("response" in access) return access.response;
    const batchId = new URL(request.url).searchParams.get("batch_id");
    if (!batchId) return jsonError("Batch ID is required.");
    const batch = await loadScopedAttendanceImportBatch(access, batchId);
    if (!batch) return jsonError("Import batch not found.", 404);
    const rows = await loadBatchRows(access, batchId);
    const csv = [
      "Row,Column,Labour Code,Worker,Date,Code,Validation,Warnings,Errors,Execution",
      ...rows.map((row: any) => [
        row.source_row_number,
        row.source_column || "",
        row.labour_code || "",
        row.worker_name || "",
        row.attendance_date || "",
        row.attendance_code || "",
        row.validation_status,
        (row.validation_warnings || []).join("; "),
        (row.validation_errors || []).join("; "),
        row.execution_status,
      ].map(csvEscape).join(",")),
    ].join("\n");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename=labour-attendance-import-${batchId}.csv`,
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to export attendance import report.", 500);
  }
}
