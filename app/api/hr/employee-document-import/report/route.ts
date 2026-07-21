import { NextResponse } from "next/server";
import { summarizeDocumentImportRows } from "@/lib/hr/employeeDocumentImport";
import { adminClient, jsonError, loadScopedBatch, requireDocumentImportPermission } from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireDocumentImportPermission(request, "export");
    if ("response" in auth) return auth.response;

    const batchId = new URL(request.url).searchParams.get("batch_id")?.trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadScopedBatch(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;

    const { data, error } = await admin
      .from("employee_document_import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .order("source_row_number");
    if (error) throw error;

    return NextResponse.json({
      batch: batchResult.batch,
      summary: summarizeDocumentImportRows(data || []),
      rows: data || [],
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee document import report.", 500);
  }
}
