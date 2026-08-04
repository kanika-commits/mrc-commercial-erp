import { NextResponse } from "next/server";
import { employeeImportReason, executeImportRow, importedBy, summarizeRows } from "@/lib/hr/employeeImport";
import { DOCUMENT_IMPORT_MIME_TYPES, MAX_DOCUMENT_IMPORT_FILE_SIZE } from "@/lib/hr/employeeDocumentImport";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { downloadDriveFile } from "@/src/lib/googleDrive";
import { adminClient, jsonError, loadBatchForActor, requireImportPermission } from "../_shared";

const DOCUMENT_BUCKET = "employee-documents";

function safeFileName(value: string) {
  return String(value || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "document";
}

async function attachEmployeeImportDocuments(admin: ReturnType<typeof adminClient>, auth: any, batch: any, row: any, employeeId: string, request: Request) {
  const manifest = row.normalized_data?.document_manifest || {};
  const entries = Object.values(manifest).filter((entry: any) => entry?.source_drive_file_id && entry?.document_type) as any[];
  const documentIds: string[] = [];
  const actor = importedBy(auth);

  for (const entry of entries) {
    const driveFile = await downloadDriveFile({
      fileId: entry.source_drive_file_id,
      maxSizeBytes: MAX_DOCUMENT_IMPORT_FILE_SIZE,
    });
    if (!DOCUMENT_IMPORT_MIME_TYPES.has(driveFile.mime_type)) {
      throw new Error(`${entry.document_type} Drive file MIME type is not supported.`);
    }
    const { data: existingVersions, error: versionError } = await admin
      .from("employee_documents")
      .select("id, version")
      .eq("employee_id", employeeId)
      .eq("document_type", entry.document_type)
      .order("version", { ascending: false });
    if (versionError) throw versionError;

    const previousActiveIds = (existingVersions || []).map((doc: any) => doc.id);
    const nextVersion = Math.max(0, ...(existingVersions || []).map((doc: any) => Number(doc.version || 1))) + 1;
    const fileName = driveFile.file_name || entry.file_name || `${entry.document_type}.pdf`;
    const storagePath = `${batch.organization_id}/${employeeId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}`;
    const buffer = Buffer.from(driveFile.base64, "base64");
    const { error: uploadError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, buffer, { contentType: driveFile.mime_type, upsert: false });
    if (uploadError) throw uploadError;

    try {
      const { data: document, error: insertError } = await admin
        .from("employee_documents")
        .insert({
          organization_id: batch.organization_id,
          employee_id: employeeId,
          document_type: entry.document_type,
          document_name: fileName,
          storage_path: storagePath,
          file_url: storagePath,
          metadata: {
            ...(entry.metadata || {}),
            source_drive_file_id: entry.source_drive_file_id,
            source_drive_url: entry.source_drive_url,
            import_batch_id: batch.id,
            import_row_id: row.id,
            source_row_number: row.source_row_number,
          },
          version: nextVersion,
          is_active: true,
          mime_type: driveFile.mime_type,
          file_size: buffer.length,
          uploaded_by: auth.user.id,
          uploaded_by_name: actor.name,
          uploaded_by_email: actor.email,
        })
        .select("*")
        .single();
      if (insertError) throw insertError;

      if (previousActiveIds.length > 0) {
        const { error: deactivateError } = await admin
          .from("employee_documents")
          .update({
            is_active: false,
            replaced_by_document_id: document.id,
            updated_by: auth.user.id,
            updated_by_name: actor.name,
            updated_by_email: actor.email,
            updated_at: new Date().toISOString(),
          })
          .in("id", previousActiveIds);
        if (deactivateError) throw deactivateError;
      }

      await insertErpAuditLog(admin, auth.user, {
        organizationId: batch.organization_id,
        companyId: row.matched_company_id,
        siteId: row.matched_site_id,
        moduleCode: "hr_employee_import",
        entityType: "employee_document",
        recordId: document.id,
        parentEntityType: "hr_employee",
        parentRecordId: employeeId,
        action: previousActiveIds.length > 0 ? "document_replace" : "document_upload",
        description: `${entry.document_type} document attached from unified Employee Import row ${row.source_row_number}.`,
        oldValues: previousActiveIds.length > 0 ? { replaced_document_ids: previousActiveIds } : null,
        newValues: { id: document.id, document_type: document.document_type, version: document.version },
        source: "import",
        importBatchId: batch.id,
      }, request);
      documentIds.push(document.id);
    } catch (error) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
      throw error;
    }
  }

  return documentIds;
}

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
    if (batchResult.batch.status === "executing") {
      return jsonError("This import batch is currently executing.", 409);
    }

    const { data: rows, error: rowsError } = await admin
      .from("employee_import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .in("validation_status", ["valid", "warning"])
      .eq("import_status", "pending")
      .order("source_row_number");
    if (rowsError) throw rowsError;
    if ((rows || []).length === 0) {
      return jsonError("No Ready employee rows are available to import.", 409);
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

    const results: any[] = [];

    for (const row of rows || []) {
      let rowResult: any = {};
      try {
        rowResult = await executeImportRow(admin, auth, batchResult.batch, row, request);
      } catch (error: any) {
        const message = userFriendlyImportError(error.message || "Import failed.");
        await admin
          .from("employee_import_rows")
          .update({
            import_status: "failed",
            import_result: { status: "failed", message },
            errors: [...(row.errors || []), message],
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        rowResult = { status: "failed", message };
      }
      if (rowResult.status === "imported" && rowResult.employeeId) {
        try {
          if (row.normalized_data?.reporting_manager_id) {
            const { error: managerError } = await admin
              .from("hr_employees")
              .update({ reporting_manager_id: row.normalized_data.reporting_manager_id, updated_at: new Date().toISOString() })
              .eq("id", rowResult.employeeId)
              .eq("organization_id", batchResult.batch.organization_id);
            if (managerError) throw managerError;
          }
          const documentIds = await attachEmployeeImportDocuments(admin, auth, batchResult.batch, row, rowResult.employeeId, request);
          rowResult.documents = documentIds.length;
        } catch (documentError: any) {
          await admin.from("hr_employees").delete().eq("id", rowResult.employeeId);
          await admin
            .from("employee_import_rows")
            .update({
              import_status: "failed",
              import_result: { status: "failed", message: documentError.message || "Document attachment failed." },
              errors: [...(row.errors || []), documentError.message || "Document attachment failed."],
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          rowResult.status = "failed";
          rowResult.message = documentError.message || "Document attachment failed.";
        }
      }
      results.push({ row_id: row.id, ...rowResult });
    }

    const { data: allRows, error: allRowsError } = await admin
      .from("employee_import_rows")
      .select("source_row_number, raw_data, normalized_data, validation_status, import_status, errors, warnings, imported_employee_id, import_result")
      .eq("batch_id", batchId);
    if (allRowsError) throw allRowsError;

    const summary = summarizeRows(allRows || []);
    const finalStatus = summary.failed > 0 || summary.invalid > 0 ? "completed_with_errors" : "completed";
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

    return NextResponse.json({
      batch,
      summary,
      results,
      result_rows: (allRows || []).map((row: any) => ({
        ...row,
        reason: employeeImportReason(row),
      })),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to execute employee import.", 500);
  }
}

function userFriendlyImportError(message: string) {
  if (/duplicate key|unique constraint|already exists/i.test(message)) return "Employee already exists.";
  if (/violates not-null constraint|required/i.test(message)) return "Required field missing.";
  if (/invalid input syntax|date\/time field value out of range|invalid date/i.test(message)) return "Invalid date or field format.";
  if (/foreign key/i.test(message)) return "Referenced HR master was not found.";
  return message;
}
