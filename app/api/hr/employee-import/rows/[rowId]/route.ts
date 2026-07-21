import { NextResponse } from "next/server";
import {
  loadImportMasterData,
  summarizeRows,
  validateNormalizedRow,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../../_shared";

type RouteParams = {
  params: Promise<{ rowId: string }>;
};

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const { rowId } = await params;
    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    const normalizedPatch = (payload.normalized_patch || {}) as Record<string, unknown>;

    if (!batchId) return jsonError("batch_id is required.");
    if (!rowId) return jsonError("row id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;
    if (batchResult.batch.status === "completed") {
      return jsonError("Completed import batches cannot be changed.", 409);
    }

    const { data: row, error: rowError } = await admin
      .from("employee_import_rows")
      .select("*")
      .eq("id", rowId)
      .eq("batch_id", batchId)
      .maybeSingle();

    if (rowError) throw rowError;
    if (!row) return jsonError("Import row was not found.", 404);
    if (row.import_status !== "pending") {
      return jsonError("Only pending import rows can be corrected.", 409);
    }

    const normalized = { ...(row.normalized_data || {}) };
    const warnings = Array.isArray(row.warnings) ? [...row.warnings] : [];

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "date_of_birth")) {
      const rawValue = String(normalizedPatch.date_of_birth ?? "").trim();
      if (rawValue) {
        normalized.date_of_birth = rawValue;
      } else {
        if (!payload.warning_acknowledged) {
          return jsonError("A warning acknowledgement is required before clearing the workbook DOB.");
        }
        normalized.date_of_birth = null;
        warnings.push("Date of birth was cleared by user acknowledgement; original workbook value remains in raw import data.");
      }
    }

    const masters = await loadImportMasterData(admin, auth);
    const validation = validateNormalizedRow(normalized, masters, batchResult.batch.mapping || {});
    const mergedWarnings = [...validation.warnings, ...warnings.filter((warning) => !validation.warnings.includes(warning))];

    const { data: updatedRow, error: updateError } = await admin
      .from("employee_import_rows")
      .update({
        normalized_data: validation.normalized || normalized,
        mapping_status: validation.mappingStatus,
        validation_status: validation.errors.length > 0 ? "invalid" : mergedWarnings.length > 0 ? "warning" : "valid",
        errors: validation.errors,
        warnings: mergedWarnings,
        matched_company_id: validation.matches.company_id,
        matched_site_id: validation.matches.site_id,
        matched_department_id: validation.matches.department_id,
        matched_designation_id: validation.matches.designation_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId)
      .select("*")
      .single();

    if (updateError) throw updateError;

    const { data: rows, error: rowsError } = await admin
      .from("employee_import_rows")
      .select("validation_status, import_status")
      .eq("batch_id", batchId);

    if (rowsError) throw rowsError;

    const summary = summarizeRows(rows || []);
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

    return NextResponse.json({ batch, row: updatedRow, summary });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update import row.", 500);
  }
}
