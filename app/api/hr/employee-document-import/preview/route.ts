import { NextResponse } from "next/server";
import { adminClient, jsonError, loadScopedBatch, requireDocumentImportPermission } from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireDocumentImportPermission(request, "view");
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("page_size") || 100) || 100));
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadScopedBatch(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await admin
      .from("employee_document_import_rows")
      .select("*", { count: "exact" })
      .eq("batch_id", batchId)
      .order("source_row_number")
      .range(from, to);
    if (error) throw error;

    const matchedEmployeeIds = Array.from(new Set((data || []).map((row: any) => row.matched_employee_id).filter(Boolean)));
    const { data: matchedEmployees, error: employeeError } = matchedEmployeeIds.length
      ? await admin
          .from("hr_employees")
          .select("id, employee_code, employee_name")
          .in("id", matchedEmployeeIds)
      : { data: [], error: null };
    if (employeeError) throw employeeError;

    const employeeById = new Map((matchedEmployees || []).map((employee: any) => [employee.id, employee]));
    const rows = (data || []).map((row: any) => ({
      ...row,
      matched_employee: row.matched_employee_id ? employeeById.get(row.matched_employee_id) || null : null,
    }));

    return NextResponse.json({
      batch: batchResult.batch,
      rows,
      total: count || 0,
      page,
      page_size: pageSize,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee document import preview.", 500);
  }
}
