import { NextResponse } from "next/server";
import { adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";
import { loadImportMasterData } from "@/lib/hr/employeeImport";

export async function GET(request: Request) {
  try {
    const auth = await requireImportPermission(request, "view");
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("page_size") || 100) || 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId);
    if ("response" in batchResult) return batchResult.response;
    const masters = await loadImportMasterData(admin, auth);

    const { data, error, count } = await admin
      .from("employee_import_rows")
      .select("*", { count: "exact" })
      .eq("batch_id", batchId)
      .order("source_row_number")
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      batch: batchResult.batch,
      rows: data || [],
      masters,
      total: count || 0,
      page,
      page_size: pageSize,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load import preview.", 500);
  }
}
