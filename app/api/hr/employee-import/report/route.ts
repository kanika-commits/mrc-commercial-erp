import { NextResponse } from "next/server";
import { summarizeRows } from "@/lib/hr/employeeImport";
import { adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireImportPermission(request, "view");
    if ("response" in auth) return auth.response;

    const batchId = new URL(request.url).searchParams.get("batch_id")?.trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId);
    if ("response" in batchResult) return batchResult.response;

    const { data, error } = await admin
      .from("employee_import_rows")
      .select("source_row_number, normalized_data, validation_status, import_status, errors, warnings, imported_employee_id, import_result")
      .eq("batch_id", batchId)
      .order("source_row_number");

    if (error) throw error;

    return NextResponse.json({
      batch: batchResult.batch,
      summary: summarizeRows(data || []),
      rows: data || [],
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load import report.", 500);
  }
}
