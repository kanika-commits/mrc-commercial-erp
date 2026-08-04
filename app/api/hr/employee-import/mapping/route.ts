import { NextResponse } from "next/server";
import {
  applyExistingEmployeeStatus,
  loadImportMasterData,
  normalizeImportRow,
  summarizeRows,
  validateNormalizedRow,
  type ImportMapping,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

async function revalidateRows(admin: ReturnType<typeof adminClient>, auth: any, batch: any, mapping: ImportMapping) {
  const masters = await loadImportMasterData(admin, auth);
  const { data: rows, error } = await admin
    .from("employee_import_rows")
    .select("id, raw_data, import_status, imported_employee_id, import_result")
    .eq("batch_id", batch.id)
    .order("source_row_number");

  if (error) throw error;

  const existingEmployeeByCode = new Map(
    (masters.employees || [])
      .filter((employee: any) => employee.organization_id === batch.organization_id)
      .map((employee: any) => [
        String(employee.employee_code || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        employee,
      ]),
  );

  const updates = (rows || []).map((row: any) => {
    const normalized = normalizeImportRow(row.raw_data || {}, mapping);
    const validation = validateNormalizedRow(normalized, masters, mapping);
    const mappedNormalized = validation.normalized || normalized;
    return applyExistingEmployeeStatus({
      id: row.id,
      normalized_data: mappedNormalized,
      mapping_status: validation.mappingStatus,
      validation_status: validation.validationStatus,
      import_status: row.import_status === "imported" ? "imported" : "pending",
      imported_employee_id: row.import_status === "imported" ? row.imported_employee_id : null,
      import_result: row.import_status === "imported" ? (row.import_result || {}) : {},
      errors: validation.errors,
      warnings: validation.warnings,
      matched_company_id: validation.matches.company_id,
      matched_site_id: validation.matches.site_id,
      matched_department_id: validation.matches.department_id,
      matched_designation_id: validation.matches.designation_id,
      updated_at: new Date().toISOString(),
    }, existingEmployeeByCode);
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
    const batchResult = await loadBatchForActor(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;
    if (batchResult.batch.status === "completed") {
      return jsonError("Completed import batches cannot be remapped.", 409);
    }

    const updates = await revalidateRows(admin, auth, batchResult.batch, mapping);
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
