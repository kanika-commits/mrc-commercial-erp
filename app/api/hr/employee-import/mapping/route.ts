import { NextResponse } from "next/server";
import {
  loadImportMasterData,
  normalizeImportRow,
  summarizeRows,
  validateNormalizedRow,
  type ImportMapping,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

async function revalidateRows(admin: ReturnType<typeof adminClient>, auth: any, batchId: string, mapping: ImportMapping) {
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
    const mappedNormalized = validation.normalized || normalized;
    return {
      id: row.id,
      normalized_data: mappedNormalized,
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

  return updates;
}

export async function PUT(request: Request) {
  try {
    const auth = await requireImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    const mapping = (payload.mapping || {}) as ImportMapping;
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId);
    if ("response" in batchResult) return batchResult.response;
    if (batchResult.batch.status === "completed") {
      return jsonError("Completed import batches cannot be remapped.", 409);
    }

    const updates = await revalidateRows(admin, auth, batchId, mapping);
    const summary = summarizeRows(updates);
    const status = summary.invalid > 0 ? "validated" : "ready";
    const { data: batch, error: batchError } = await admin
      .from("employee_import_batches")
      .update({
        mapping,
        summary,
        status,
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
    return jsonError(error.message || "Failed to update import mapping.", 500);
  }
}
