import { NextResponse } from "next/server";
import { importedBy, summarizeRows } from "@/lib/hr/employeeImport";
import { adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireImportPermission(request, "execute");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;
    if (["completed", "executing"].includes(batchResult.batch.status)) {
      return jsonError("This import batch has already been executed or is currently executing.", 409);
    }

    const { data: invalidRows, error: invalidError } = await admin
      .from("employee_import_rows")
      .select("id")
      .eq("batch_id", batchId)
      .eq("validation_status", "invalid")
      .limit(1);
    if (invalidError) throw invalidError;
    if ((invalidRows || []).length > 0) {
      return jsonError("Resolve invalid rows before executing the import.", 409);
    }

    const actor = importedBy(auth);
    const { error: executingError } = await admin
      .from("employee_import_batches")
      .update({
        status: "executing",
        updated_by: auth.user.id,
        updated_by_name: actor.name,
        updated_by_email: actor.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
    if (executingError) throw executingError;

    const { data: rows, error: rowsError } = await admin
      .from("employee_import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .in("validation_status", ["valid", "warning"])
      .eq("import_status", "pending")
      .order("source_row_number");
    if (rowsError) throw rowsError;

    const results: any[] = [];

    for (const row of rows || []) {
      const { data: result, error: rowError } = await admin.rpc("execute_employee_import_row", {
        p_batch_id: batchId,
        p_row_id: row.id,
        p_actor_user_id: auth.user.id,
        p_actor_name: actor.name,
        p_actor_email: actor.email,
      });

      if (rowError) throw rowError;
      results.push({ row_id: row.id, ...(result || {}) });
    }

    const { data: allRows, error: allRowsError } = await admin
      .from("employee_import_rows")
      .select("validation_status, import_status")
      .eq("batch_id", batchId);
    if (allRowsError) throw allRowsError;

    const summary = summarizeRows(allRows || []);
    const finalStatus = summary.failed > 0 ? "completed_with_errors" : "completed";
    const { data: batch, error: batchError } = await admin
      .from("employee_import_batches")
      .update({
        status: finalStatus,
        summary,
        executed_by: auth.user.id,
        executed_by_name: actor.name,
        executed_by_email: actor.email,
        executed_at: new Date().toISOString(),
        updated_by: auth.user.id,
        updated_by_name: actor.name,
        updated_by_email: actor.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select("*")
      .single();
    if (batchError) throw batchError;

    return NextResponse.json({ batch, summary, results });
  } catch (error: any) {
    return jsonError(error.message || "Failed to execute employee import.", 500);
  }
}
