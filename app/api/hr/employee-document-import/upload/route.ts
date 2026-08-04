import { NextResponse } from "next/server";
import {
  DEFAULT_DOCUMENT_COLUMN_MAPPINGS,
  documentMappingForColumn,
  extractDriveUrls,
  parseEmployeeDocumentWorkbook,
  normalizeEmployeeCode,
  summarizeDocumentImportRows,
  workbookHash,
} from "@/lib/hr/employeeDocumentImport";
import {
  actorName,
  adminClient,
  jsonError,
  requireDocumentImportPermission,
  validateRowsForBatch,
  validateSelectedSite,
} from "../_shared";

function text(value: unknown) {
  return String(value || "").trim();
}

function firstText(row: Record<string, string>, headers: string[]) {
  for (const header of headers) {
    const value = text(row[header]);
    if (value) return value;
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const auth = await requireDocumentImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");
    const companyId = text(formData.get("company_id"));
    const siteId = text(formData.get("site_id"));
    const selectedSheet = text(formData.get("sheet_name")) || null;

    if (!(file instanceof File)) return jsonError("Upload an Excel workbook first.");
    if (!file.name.match(/\.(xlsx|xlsm)$/i)) return jsonError("Only .xlsx or .xlsm workbooks are supported.");
    if (file.size > 10 * 1024 * 1024) return jsonError("Document import workbook must be 10 MB or smaller.");

    const admin = adminClient();
    const siteResult = await validateSelectedSite(admin, auth, companyId, siteId);
    if ("error" in siteResult) return jsonError(siteResult.error || "Selected site is not available.", siteResult.status || 403);

    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("site_name, site_code")
      .eq("id", siteId)
      .maybeSingle();
    if (siteError) throw siteError;

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseEmployeeDocumentWorkbook(buffer, selectedSheet);
    const mapping = Object.fromEntries(
      parsed.headers
        .map((header) => [header, documentMappingForColumn(header)])
        .filter(([, value]) => Boolean(value)),
    );
    const rows: any[] = [];

    for (const row of parsed.rows) {
      const employeeCode = normalizeEmployeeCode(row.raw["Emp Id"] || row.raw["Employee Code"] || row.raw["Employee Id"]);
      const employeeName = text(row.raw["Name of Employee"] || row.raw["Employee Name"] || row.raw["Name"]);
      const fatherName = firstText(row.raw, [
        "Father's Name",
        "Father Name",
        "Father name",
        "Father",
        "Father/Husband Name",
        "Father / Husband Name",
        "Father Husband Name",
      ]);
      const sourceSite = text(row.raw.Site || row.raw.site);

      for (const header of parsed.headers) {
        const documentMapping = documentMappingForColumn(header, DEFAULT_DOCUMENT_COLUMN_MAPPINGS);
        if (!documentMapping) continue;
        const urls = extractDriveUrls(row.raw[header], row.hyperlinks[header] || []);
        for (const url of urls) {
          rows.push({
            organization_id: siteResult.organizationId,
            source_sheet_name: parsed.selectedSheet,
            source_row_number: row.rowNumber,
            employee_code: employeeCode,
            employee_name: employeeName,
            source_site: sourceSite,
            source_column: header,
            source_cell_value: row.raw[header] || "",
            source_drive_url: url,
            drive_file_id: "",
            document_type: documentMapping.documentType,
            document_metadata: {
              ...(documentMapping.metadata || {}),
              source_father_name: fatherName,
            },
            selected_action: "pending",
            validation_status: "pending",
            validation_errors: [],
            validation_warnings: [],
            execution_status: "pending",
          });
        }
      }
    }

    const actor = actorName(auth);
    const summary = summarizeDocumentImportRows(rows);
    const { data: batch, error: batchError } = await admin
      .from("employee_document_import_batches")
      .insert({
        organization_id: siteResult.organizationId,
        company_id: companyId,
        site_id: siteId,
        original_file_name: file.name,
        source_file_size: file.size,
        source_file_hash: workbookHash(buffer),
        sheet_name: parsed.selectedSheet,
        status: "uploaded",
        mapping,
        summary,
        notes: site ? `Selected ERP site: ${site.site_name || site.site_code || siteId}` : null,
        created_by: auth.user.id,
        created_by_name: actor,
        created_by_email: auth.user.email || null,
        updated_by: auth.user.id,
        updated_by_name: actor,
        updated_by_email: auth.user.email || null,
      })
      .select("*")
      .single();
    if (batchError) throw batchError;

    if (rows.length > 0) {
      const { error: rowsError } = await admin
        .from("employee_document_import_rows")
        .insert(rows.map((row) => ({ ...row, batch_id: batch.id })));
      if (rowsError) throw rowsError;
    }

    const validation = await validateRowsForBatch(admin, batch);

    return NextResponse.json({
      batch: validation.batch,
      summary: validation.summary,
      sheets: parsed.sheets,
      headers: parsed.headers,
      parsed_rows: parsed.rows.length,
      file_rows: rows.length,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to upload employee document workbook.", 500);
  }
}
