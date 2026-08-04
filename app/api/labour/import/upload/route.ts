import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission, resolveOrganizationId, validateLabourCompanySiteIndependent } from "@/app/api/labour/_shared";
import { fileHash, parseLabourWorkbook } from "@/lib/labour/import";
import { normalizeText } from "@/lib/labour/constants";
import { extractGoogleDriveFolderId } from "@/src/lib/googleDrive";

const DOCUMENT_FOLDER_SOURCE_KEY = "__document_folder_source";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Import workbook is required.");
    const organizationId = await resolveOrganizationId(access, text(formData.get("organization_id")));
    if (!organizationId) return jsonError("Could not resolve an organization for this import.", 403);
    const companyId = text(formData.get("company_id"));
    const siteId = text(formData.get("site_id"));
    if (companyId && siteId) {
      const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, companyId, siteId);
      if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseLabourWorkbook(buffer);
    if (!parsed.rows.length) return jsonError("No labour rows were found in the workbook.");
    const documentFolderUrl = text(parsed.documentFolderUrl);
    const documentFolderId = documentFolderUrl ? extractGoogleDriveFolderId(documentFolderUrl) : "";
    const documentFolderSource = documentFolderUrl
      ? {
          folder_url: documentFolderUrl,
          folder_id: documentFolderId || null,
          status: documentFolderId ? "detected" : "invalid",
          error: documentFolderId ? null : "The workbook's document folder link is not a valid Google Drive folder link.",
        }
      : null;
    const mapping = documentFolderSource ? { [DOCUMENT_FOLDER_SOURCE_KEY]: documentFolderSource } : {};

    const { data: batch, error: batchError } = await access.admin.from("labour_import_batches").insert({
      organization_id: organizationId,
      selected_company_id: companyId,
      selected_site_id: siteId,
      source_file_name: file.name,
      source_file_hash: fileHash(buffer),
      source_file_size: file.size,
      source_sheet_name: parsed.sheetName,
      status: "uploaded",
      summary: { total_rows: parsed.rows.length },
      mapping,
      ...actorFields(access.auth, "created"),
    }).select("id").single();
    if (batchError) throw batchError;

    const rows = parsed.rows.map((row) => ({
      batch_id: batch.id,
      organization_id: organizationId,
      source_row_number: row.sourceRowNumber,
      raw_data: row.raw,
      normalized_data: row.normalized,
      labour_code: null,
      worker_name: row.normalized.worker_name || null,
      father_or_husband_name: row.normalized.father_or_husband_name || null,
      contractor_text: row.normalized.contractor_text || null,
      company_text: row.normalized.company_text || null,
      site_text: row.normalized.site_text || null,
      work_order_text: null,
    }));
    const { error: rowError } = await access.admin.from("labour_import_rows").insert(rows);
    if (rowError) throw rowError;

    await audit(access, request, {
      moduleCode: "labour_import",
      action: "upload",
      entityType: "labour_import_batch",
      recordId: batch.id,
      organizationId,
      companyId,
      siteId,
      description: `Uploaded Labour Import workbook ${file.name}.`,
      newValues: { source_file_name: file.name, total_rows: rows.length, document_folder_status: documentFolderSource?.status || "not_found" },
    } as any);
    return NextResponse.json({
      batch_id: batch.id,
      rows: rows.length,
      sheet_name: parsed.sheetName,
      headers: parsed.headers,
      mapping,
      document_folder_source: documentFolderSource,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to upload labour import workbook.", 500);
  }
}
