import { NextResponse } from "next/server";
import {
  loadImportMasterData,
  normalizeImportRow,
  summarizeRows,
  validateNormalizedRow,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId);
    if ("response" in batchResult) return batchResult.response;

    const mapping = batchResult.batch.mapping || {};
    const masters = await loadImportMasterData(admin, auth);
    const { data: rows, error } = await admin
      .from("employee_import_rows")
      .select("id, raw_data")
      .eq("batch_id", batchId)
      .order("source_row_number");

    if (error) throw error;

    const updates = (rows || []).map((row: any) => {
      const normalized = normalizeImportRow(row.raw_data || {}, mapping);
      const validation = validateNormalizedRow(normalized, masters, mapping);
      return {
        id: row.id,
        normalized_data: validation.normalized || normalized,
        mapping_status: validation.mappingStatus,
        validation_status: validation.validationStatus,
        errors: validation.errors,
        warnings: validation.warnings,
        matched_company_id: validation.matches.company_id,
        matched_site_id: validation.matches.site_id,
        matched_department_id: validation.matches.department_id,
        matched_designation_id: validation.matches.designation_id,
        updated_at: new Date().toISOString(),
      };
    });

    for (const update of updates) {
      const { id, ...values } = update;
      const { error: updateError } = await admin.from("employee_import_rows").update(values).eq("id", id);
      if (updateError) throw updateError;
    }

    const summary = summarizeRows(updates);
    const { data: batch, error: batchError } = await admin
      .from("employee_import_batches")
      .update({
        summary,
        status: summary.invalid > 0 ? "validated" : "ready",
        updated_by: auth.user.id,
        updated_by_name: actorName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select("*")
      .single();

    if (batchError) throw batchError;

    return NextResponse.json({ batch, summary });
  } catch (error: any) {
    return jsonError(error.message || "Failed to validate import batch.", 500);
  }
}
