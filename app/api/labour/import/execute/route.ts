import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { POST as registerWorker } from "@/app/api/labour/workers/register/route";
import { actorFields, audit, jsonError, LABOUR_DOCUMENT_BUCKET, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { LABOUR_IMPORT_DOCUMENT_FIELDS, maskAadhaarForImport } from "@/lib/labour/import";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { downloadDriveFile } from "@/src/lib/googleDrive";

function safeMessage(message: unknown) {
  return normalizeText(message).replace(/[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}/g, "**** **** ****") || "Execution failed.";
}

async function parsePayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

function authHeaders(request: Request) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const authorization = request.headers.get("authorization");
  if (authorization) headers.authorization = authorization;
  return headers;
}

async function attachDocument(access: any, request: Request, row: any, workerId: string, field: string, type: string) {
  const normalized = row.normalized_data || {};
  const manifest = normalized.document_manifest || {};
  const sourceLink = normalizeText(normalized[field]);
  const entry = manifest[field] || manifest[sourceLink];
  if (!sourceLink && !entry) return null;
  if (!entry?.drive_file_id && !entry?.storage_key) throw new Error(`${type} file was not verified from the Google Drive link.`);
  const { data: activeRows, error: activeError } = await access.admin
    .from("labour_documents")
    .select("id, version")
    .eq("labour_worker_id", workerId)
    .eq("document_type", type)
    .eq("is_active", true)
    .order("version", { ascending: false });
  if (activeError) throw activeError;
  const nextVersion = Math.max(0, ...(activeRows || []).map((item: any) => Number(item.version) || 0)) + 1;
  const driveFile = await downloadDriveFile({
    fileId: entry.drive_file_id || entry.storage_key,
    maxSizeBytes: 10 * 1024 * 1024,
  });
  if (!driveFile.base64) throw new Error(`${type} Drive file was empty.`);
  const buffer = Buffer.from(driveFile.base64, "base64");
  if (!buffer.length) throw new Error(`${type} Drive file was empty.`);
  const fileName = driveFile.file_name || entry.original_file_name || `${type}.pdf`;
  const file = new File([buffer], fileName, { type: driveFile.mime_type || entry.mime_type || "application/octet-stream" });
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const key = safeObjectKey([row.organization_id, workerId, type, `${Date.now()}-${crypto.randomUUID()}-${fileName}`]);
  const adapter = createPrivateStorageAdapter(access.admin);
  const object = await adapter.upload({ bucket: LABOUR_DOCUMENT_BUCKET, key, file, checksum });
  const { data, error } = await access.admin.from("labour_documents").insert({
    organization_id: row.organization_id,
    labour_worker_id: workerId,
    document_type: type,
    document_name: type,
    document_number: normalized.aadhaar_number || null,
    version: nextVersion,
    is_active: true,
    storage_provider: object.provider,
    storage_bucket: object.bucket,
    storage_key: object.key,
    original_file_name: object.originalFileName,
    mime_type: object.mimeType,
    size_bytes: object.sizeBytes,
    checksum: object.checksum,
    source_url: entry.source_url || entry.drive_file_url || null,
    metadata: {
      drive_file_id: entry.drive_file_id || entry.storage_key || null,
      drive_file_url: entry.drive_file_url || entry.source_url || null,
      import_source_row_number: row.source_row_number,
      import_source_filename: entry.source_filename || entry.display_name || null,
      import_display_name: entry.display_name || entry.source_filename || null,
      original_source_url: entry.source_url || entry.drive_file_url || null,
    },
    source_type: "import",
    ...actorFields(access.auth, "uploaded"),
  }).select("id").single();
  if (error) {
    await adapter.delete({ bucket: object.bucket, key: object.key });
    throw error;
  }
  if (activeRows?.length) {
    const { error: deactivateError } = await access.admin
      .from("labour_documents")
      .update({ is_active: false, replaced_by_document_id: data.id, updated_at: new Date().toISOString() })
      .in("id", activeRows.map((item: any) => item.id));
    if (deactivateError) throw deactivateError;
  }
  await audit(access, request, {
    moduleCode: "labour_documents",
    action: "document_upload",
    entityType: "labour_document",
    recordId: data.id,
    organizationId: row.organization_id,
    description: `Imported ${type} document for labour worker.`,
    importBatchId: row.batch_id,
    newValues: {
      labour_worker_id: workerId,
      document_type: type,
      original_file_name: object.originalFileName,
      size_bytes: object.sizeBytes,
    },
  } as any);
  return data.id;
}

async function attachImportDocuments(access: any, request: Request, row: any, workerId: string) {
  const documentIds: string[] = [];
  const warnings: string[] = [];
  for (const { field, documentType } of LABOUR_IMPORT_DOCUMENT_FIELDS) {
    try {
      const documentId = await attachDocument(access, request, row, workerId, field, documentType);
      if (documentId) documentIds.push(documentId);
    } catch (error: any) {
      warnings.push(`${documentType}: ${safeMessage(error.message)}`);
    }
  }
  return { documentIds, warnings };
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const { batch_id } = await request.json().catch(() => ({}));
    if (!batch_id) return jsonError("Batch ID is required.");
    const batch = await loadScopedLabourImportBatch(access, batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);
    const { data: rows, error: rowsError } = await access.admin
      .from("labour_import_rows")
      .select("*")
      .eq("batch_id", batch_id)
      .in("validation_status", ["ready", "warning"])
      .in("selected_action", ["create", "skip"])
      .eq("execution_status", "pending")
      .order("source_row_number");
    if (rowsError) throw rowsError;

    let executed = 0;
    let skipped = 0;
    let failed = 0;
    const origin = new URL(request.url).origin;
    for (const row of rows || []) {
      let createdNewWorkerId: string | null = null;
      try {
        const n = row.normalized_data || {};
        if (row.selected_action === "skip" || row.matched_labour_worker_id) {
          await access.admin.from("labour_import_rows").update({
            execution_status: "skipped",
            validation_status: "skipped",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          skipped += 1;
          await audit(access, request, {
            moduleCode: "labour_import",
            action: "skip_existing",
            entityType: "labour_import_row",
            recordId: row.id,
            organizationId: batch.organization_id,
            companyId: row.matched_company_id,
            siteId: row.matched_site_id,
            description: `Skipped existing labour import row ${row.source_row_number}.`,
            importBatchId: batch_id,
            newValues: { source_row_number: row.source_row_number, aadhaar: maskAadhaarForImport(n.aadhaar_number) },
          } as any);
          continue;
        }

        const registrationResponse = await registerWorker(new Request(`${origin}/api/labour/workers/register`, {
          method: "POST",
          headers: authHeaders(request),
          body: JSON.stringify({
            organization_id: batch.organization_id,
            company_id: row.matched_company_id,
            site_id: row.matched_site_id,
            contractor_profile_id: row.matched_contractor_profile_id,
            vendor_id: row.matched_contractor_profile_id ? undefined : n.contractor_vendor_id,
            labour_trade_id: n.labour_trade_id,
            work_order_id: n.work_order_id || undefined,
            commercial_model: n.commercial_model || undefined,
            worker_name: n.worker_name,
            father_or_husband_name: n.father_or_husband_name,
            gender: n.gender,
            date_of_birth: n.date_of_birth,
            aadhaar_number: n.aadhaar_number,
            mobile_number: n.mobile_number,
            alternate_mobile_number: n.alternate_mobile_number,
            uan_number: n.uan_number,
            esi_number: n.esi_number,
            bank_account_number: n.bank_account_number,
            bank_ifsc: n.bank_ifsc,
            bank_name: n.bank_name,
            status: n.status,
            skill_level: n.skill_level,
            wage_rate: n.wage_rate,
            effective_from: n.date_of_joining,
            remarks: n.remarks || `Created from Labour Import row ${row.source_row_number}.`,
          }),
        }));
        const registrationPayload = await parsePayload(registrationResponse);
        if (!registrationResponse.ok || !registrationPayload.labour_worker_id) {
          throw new Error(registrationPayload.error || registrationPayload.message || "Registration failed.");
        }
        createdNewWorkerId = registrationPayload.action === "registered" ? registrationPayload.labour_worker_id : null;

        const { documentIds, warnings: documentWarnings } = await attachImportDocuments(access, request, row, registrationPayload.labour_worker_id);

        await access.admin.from("labour_import_rows").update({
          execution_status: "executed",
          validation_status: "executed",
          created_labour_worker_id: registrationPayload.labour_worker_id,
          validation_warnings: [...(row.validation_warnings || []), ...documentWarnings],
          normalized_data: {
            ...(row.normalized_data || {}),
            document_import_warnings: documentWarnings,
            document_import_status: documentWarnings.length ? "imported_with_document_warnings" : "imported",
          },
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        await audit(access, request, {
          moduleCode: "labour_import",
          action: "import",
          entityType: "labour_worker",
          recordId: registrationPayload.labour_worker_id,
          organizationId: batch.organization_id,
          companyId: row.matched_company_id,
          siteId: row.matched_site_id,
          description: `Imported labourer from row ${row.source_row_number}.`,
          importBatchId: batch_id,
          newValues: { source_row_number: row.source_row_number, worker_name: n.worker_name, documents: documentIds.length, document_warnings: documentWarnings.length, aadhaar: maskAadhaarForImport(n.aadhaar_number) },
        } as any);
        executed += 1;
      } catch (rowError: any) {
        if (createdNewWorkerId) {
          await access.admin.from("labour_workers").delete().eq("id", createdNewWorkerId);
        }
        failed += 1;
        await access.admin.from("labour_import_rows").update({
          execution_status: "failed",
          validation_status: "failed",
          validation_errors: [safeMessage(rowError.message)],
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }

    await access.admin.from("labour_import_batches").update({
      status: failed ? "failed" : "executed",
      summary: { ...(batch.summary || {}), executed_rows: executed, skipped_rows: skipped, failed_rows: failed },
      executed_at: new Date().toISOString(),
      executed_by: access.auth.user.id,
      executed_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.email,
      executed_by_email: access.auth.user.email || null,
    }).eq("id", batch_id);

    return NextResponse.json({ executed, skipped, failed });
  } catch (error: any) {
    return jsonError(safeMessage(error.message) || "Failed to execute labour import.", 500);
  }
}
