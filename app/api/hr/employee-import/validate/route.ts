import { NextResponse } from "next/server";
import {
  EMPLOYEE_IMPORT_DOCUMENT_FIELDS,
  applyExistingEmployeeStatus,
  loadImportMasterData,
  normalizeImportRow,
  summarizeRows,
  validateNormalizedRow,
} from "@/lib/hr/employeeImport";
import { DOCUMENT_IMPORT_MIME_TYPES, MAX_DOCUMENT_IMPORT_FILE_SIZE } from "@/lib/hr/employeeDocumentImport";
import { downloadDriveFile, extractGoogleDriveFileId, googleDriveFileUrl } from "@/src/lib/googleDrive";
import { actorName, adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

async function verifyDriveDocument(link: string, label: string) {
  const driveFileId = extractGoogleDriveFileId(link);
  if (!driveFileId) throw new Error(`${label} must be a valid Google Drive file link.`);
  const driveFile = await downloadDriveFile({ fileId: driveFileId, maxSizeBytes: MAX_DOCUMENT_IMPORT_FILE_SIZE });
  if (!DOCUMENT_IMPORT_MIME_TYPES.has(driveFile.mime_type)) {
    throw new Error(`${label} must point to a supported PDF or image file.`);
  }
  return {
    source_drive_file_id: driveFile.file_id,
    source_drive_url: link,
    drive_file_url: googleDriveFileUrl(driveFile.file_id),
    file_name: driveFile.file_name,
    mime_type: driveFile.mime_type,
    size_bytes: driveFile.size_bytes,
  };
}

async function verifyEmployeeDocuments(normalized: Record<string, any>) {
  const manifest: Record<string, any> = {};
  const errors: string[] = [];
  await Promise.all(EMPLOYEE_IMPORT_DOCUMENT_FIELDS.map(async (config) => {
    const link = String(normalized[config.field] || "").trim();
    if (!link) return;
    try {
      manifest[config.field] = {
        ...await verifyDriveDocument(link, config.label),
        document_type: config.documentType,
        metadata: "metadata" in config ? config.metadata : {},
      };
    } catch (error: any) {
      errors.push(error.message || `${config.label} could not be verified.`);
    }
  }));
  return { manifest, errors };
}

export async function POST(request: Request) {
  try {
    const auth = await requireImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadBatchForActor(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;

    const mapping = batchResult.batch.mapping || {};
    const masters = await loadImportMasterData(admin, auth);
    const { data: rows, error } = await admin
      .from("employee_import_rows")
      .select("id, raw_data, import_status, imported_employee_id, import_result")
      .eq("batch_id", batchId)
      .order("source_row_number");

    if (error) throw error;

    const existingEmployeeByCode = new Map(
      (masters.employees || [])
        .filter((employee: any) => employee.organization_id === batchResult.batch.organization_id)
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
    const updates = [];
    for (const row of rows || []) {
      const normalized = normalizeImportRow(row.raw_data || {}, mapping);
      const validation = validateNormalizedRow(normalized, masters, mapping);
      const baseUpdate = applyExistingEmployeeStatus({
        id: row.id,
        normalized_data: validation.normalized || normalized,
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

      if (baseUpdate.import_status === "skipped" || baseUpdate.import_status === "imported") {
        updates.push(baseUpdate);
        continue;
      }

      const { manifest, errors: documentErrors } = await verifyEmployeeDocuments(validation.normalized || normalized);
      const documentCount = Object.keys(manifest).length;
      const documentLinkCount = EMPLOYEE_IMPORT_DOCUMENT_FIELDS.filter((field) => normalized[field.field]).length;
      const errors = [...validation.errors, ...documentErrors];
      const update = {
        id: row.id,
        normalized_data: {
          ...(validation.normalized || normalized),
          document_manifest: manifest,
          documents_found: documentCount,
          documents_expected: documentLinkCount,
        },
        mapping_status: validation.mappingStatus,
        validation_status: errors.length > 0 ? "invalid" : validation.validationStatus,
        import_status: row.import_status === "imported" ? "imported" : "pending",
        imported_employee_id: row.import_status === "imported" ? row.imported_employee_id : null,
        import_result: row.import_status === "imported" ? (row.import_result || {}) : {},
        errors,
        warnings: validation.warnings,
        matched_company_id: validation.matches.company_id,
        matched_site_id: validation.matches.site_id,
        matched_department_id: validation.matches.department_id,
        matched_designation_id: validation.matches.designation_id,
        updated_at: new Date().toISOString(),
      };
      updates.push(update);
    }

    for (const update of updates) {
      const { id, ...values } = update;
      const { error: updateError } = await admin.from("employee_import_rows").update(values).eq("id", id);
      if (updateError) throw updateError;
    }

    const summary = {
      ...summarizeRows(updates),
      documents_found: updates.reduce((sum, row) => sum + Number(row.normalized_data.documents_found || 0), 0),
      document_errors: updates.reduce((sum, row) => sum + Math.max(0, Number(row.normalized_data.documents_expected || 0) - Number(row.normalized_data.documents_found || 0)), 0),
    };
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
