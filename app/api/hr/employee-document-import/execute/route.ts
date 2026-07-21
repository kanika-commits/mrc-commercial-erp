import { NextResponse } from "next/server";
import { downloadDriveFile } from "@/src/lib/googleDrive";
import { insertErpAuditLog } from "@/lib/serverAudit";
import {
  DOCUMENT_IMPORT_MIME_TYPES,
  MAX_DOCUMENT_IMPORT_FILE_SIZE,
  summarizeDocumentImportRows,
} from "@/lib/hr/employeeDocumentImport";
import { actorName, adminClient, jsonError, loadScopedBatch, requireDocumentImportPermission, validateRowsForBatch } from "../_shared";

const DOCUMENT_BUCKET = "employee-documents";

function safeFileName(value: string) {
  return String(value || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "document";
}

async function executeRow(admin: ReturnType<typeof adminClient>, auth: any, batch: any, row: any, request: Request) {
  if (row.execution_status === "imported") return { row_id: row.id, status: "skipped", message: "Already imported." };
  if (row.selected_action === "skip") {
    await admin
      .from("employee_document_import_rows")
      .update({ execution_status: "skipped", executed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { row_id: row.id, status: "skipped", message: "Skipped by selected action." };
  }
  if (row.validation_status !== "ready") {
    throw new Error("Only ready rows can be executed.");
  }
  if (!row.matched_employee_id) throw new Error("Matched employee is required.");
  if (!row.drive_file_id) throw new Error("Drive file ID is required.");

  const { data: employee, error: employeeError } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, status")
    .eq("id", row.matched_employee_id)
    .eq("organization_id", batch.organization_id)
    .eq("company_id", batch.company_id)
    .eq("site_id", batch.site_id)
    .neq("status", "deleted")
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) throw new Error("Matched employee is no longer available for this site.");

  const driveFile = await downloadDriveFile({
    fileId: row.drive_file_id,
    maxSizeBytes: MAX_DOCUMENT_IMPORT_FILE_SIZE,
  });
  if (!DOCUMENT_IMPORT_MIME_TYPES.has(driveFile.mime_type)) {
    throw new Error("Drive file MIME type is not supported for employee documents.");
  }
  if (driveFile.size_bytes > MAX_DOCUMENT_IMPORT_FILE_SIZE) {
    throw new Error("Drive file is too large for employee document import.");
  }

  const { data: existingVersions, error: versionError } = await admin
    .from("employee_documents")
    .select("id, version")
    .eq("employee_id", employee.id)
    .eq("document_type", row.document_type)
    .order("version", { ascending: false });
  if (versionError) throw versionError;

  const previousActiveIds = (existingVersions || []).map((doc: any) => doc.id);
  if (previousActiveIds.length > 0 && row.selected_action !== "new_version") {
    throw new Error("Existing active document found; choose New Version or Skip before execution.");
  }

  const nextVersion = Math.max(0, ...(existingVersions || []).map((doc: any) => Number(doc.version || 1))) + 1;
  const fileName = driveFile.file_name || `${row.document_type}.pdf`;
  const storagePath = `${employee.organization_id}/${employee.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}`;
  const buffer = Buffer.from(driveFile.base64, "base64");
  const { error: uploadError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buffer, { contentType: driveFile.mime_type, upsert: false });
  if (uploadError) throw uploadError;

  try {
    const { data: document, error: insertError } = await admin
      .from("employee_documents")
      .insert({
        organization_id: employee.organization_id,
        employee_id: employee.id,
        document_type: row.document_type,
        document_name: fileName,
        storage_path: storagePath,
        file_url: storagePath,
        metadata: {
          ...(row.document_metadata || {}),
          source_drive_file_id: row.drive_file_id,
          source_drive_url: row.source_drive_url,
          import_batch_id: batch.id,
          import_row_id: row.id,
        },
        version: nextVersion,
        is_active: true,
        mime_type: driveFile.mime_type,
        file_size: buffer.length,
        uploaded_by: auth.user.id,
        uploaded_by_name: actorName(auth),
        uploaded_by_email: auth.user.email || null,
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
          updated_by_name: actorName(auth),
          updated_by_email: auth.user.email || null,
          updated_at: new Date().toISOString(),
        })
        .in("id", previousActiveIds);
      if (deactivateError) throw deactivateError;
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: "hr_employees",
      entityType: "employee_document",
      recordId: document.id,
      parentEntityType: "hr_employee",
      parentRecordId: employee.id,
      action: previousActiveIds.length > 0 ? "document_replace" : "document_upload",
      description: `${row.document_type} document imported from site workbook.`,
      oldValues: previousActiveIds.length > 0 ? { replaced_document_ids: previousActiveIds } : null,
      newValues: { id: document.id, document_type: document.document_type, version: document.version },
      source: "import",
      importBatchId: batch.id,
    }, request);

    await admin
      .from("employee_document_import_rows")
      .update({
        execution_status: "imported",
        execution_error: null,
        source_file_name: fileName,
        source_mime_type: driveFile.mime_type,
        source_size_bytes: buffer.length,
        created_employee_document_id: document.id,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return { row_id: row.id, status: "imported", employee_document_id: document.id };
  } catch (error) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    throw error;
  }
}

async function executeRowsBounded(
  rows: any[],
  worker: (row: any) => Promise<any>,
  concurrency = 2,
) {
  const results: any[] = [];
  const pending = [...rows];
  const activeKeys = new Set<string>();
  let activeCount = 0;

  await new Promise<void>((resolve) => {
    const pump = () => {
      if (pending.length === 0 && activeCount === 0) {
        resolve();
        return;
      }

      while (activeCount < concurrency) {
        const index = pending.findIndex((row) => {
          const key = `${row.matched_employee_id}||${row.document_type}`;
          return !activeKeys.has(key);
        });
        if (index < 0) break;

        const [row] = pending.splice(index, 1);
        const key = `${row.matched_employee_id}||${row.document_type}`;
        activeKeys.add(key);
        activeCount += 1;

        worker(row)
          .then((result) => results.push(result))
          .catch((error: any) => results.push({ row_id: row.id, status: "failed", error: error.message || "Document import failed." }))
          .finally(() => {
            activeKeys.delete(key);
            activeCount -= 1;
            pump();
          });
      }
    };

    pump();
  });

  return results;
}

export async function POST(request: Request) {
  try {
    const auth = await requireDocumentImportPermission(request, "execute");
    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const batchId = String(payload.batch_id || "").trim();
    if (!batchId) return jsonError("batch_id is required.");

    const admin = adminClient();
    const batchResult = await loadScopedBatch(admin, batchId, auth);
    if ("response" in batchResult) return batchResult.response;
    if (["completed", "executing"].includes(batchResult.batch.status)) {
      return jsonError("This document import batch has already been executed or is currently executing.", 409);
    }

    const validation = await validateRowsForBatch(admin, batchResult.batch);
    const { data: rows, error: rowsError } = await admin
      .from("employee_document_import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .eq("validation_status", "ready")
      .eq("execution_status", "pending")
      .neq("selected_action", "skip")
      .order("source_row_number");
    if (rowsError) throw rowsError;

    await admin
      .from("employee_document_import_batches")
      .update({ status: "executing", updated_at: new Date().toISOString() })
      .eq("id", batchId);

    const results = await executeRowsBounded(rows || [], async (row) => {
      try {
        return await executeRow(admin, auth, validation.batch, row, request);
      } catch (error: any) {
        const message = error.message || "Document import failed.";
        await admin
          .from("employee_document_import_rows")
          .update({
            execution_status: "failed",
            execution_error: message,
            executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        return { row_id: row.id, status: "failed", error: message };
      }
    });

    const { data: allRows, error: allRowsError } = await admin
      .from("employee_document_import_rows")
      .select("validation_status, execution_status")
      .eq("batch_id", batchId);
    if (allRowsError) throw allRowsError;

    const summary = summarizeDocumentImportRows(allRows || []);
    const finalStatus = summary.failed > 0 ? "completed_with_errors" : "completed";
    const { data: batch, error: batchError } = await admin
      .from("employee_document_import_batches")
      .update({
        status: finalStatus,
        summary,
        completed_at: new Date().toISOString(),
        updated_by: auth.user.id,
        updated_by_name: actorName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select("*")
      .single();
    if (batchError) throw batchError;

    return NextResponse.json({ batch, summary, results });
  } catch (error: any) {
    return jsonError(error.message || "Failed to execute employee document import.", 500);
  }
}
