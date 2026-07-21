import { NextResponse } from "next/server";
import {
  acceptedWorkbookFile,
  importedBy,
  loadImportMasterData,
  mappingFromHeaders,
  parseEmployeeWorkbook,
  isImportableEmployeeRow,
  rowPayloadForInsert,
  scopedOrganizationId,
  summarizeRows,
  workbookHash,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, requireImportPermission } from "../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireImportPermission(request, "upload");
    if ("response" in auth) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");
    const preferredOrganizationId = String(formData.get("organization_id") || "").trim() || null;

    if (!(file instanceof File)) {
      return jsonError("Upload an Excel workbook first.");
    }

    if (!acceptedWorkbookFile(file)) {
      return jsonError("Only .xlsx or .xlsm employee workbooks are supported.");
    }

    if (file.size > 10 * 1024 * 1024) {
      return jsonError("Employee import workbook must be 10 MB or smaller.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseEmployeeWorkbook(buffer);
    const admin = adminClient();
    const organizationId = await scopedOrganizationId(admin, auth, preferredOrganizationId);

    if (!organizationId) {
      return jsonError("Could not resolve an organization for this import.", 403);
    }

    const mapping = mappingFromHeaders(parsed.headers);
    const masters = await loadImportMasterData(admin, auth);
    const employeeRows = parsed.rows.filter((row) => isImportableEmployeeRow(row.raw, mapping));
    const skippedRows = parsed.rows.length - employeeRows.length;
    const rowPayloads = employeeRows.map((row) =>
      rowPayloadForInsert(row, mapping, masters, organizationId),
    );
    const summary = summarizeRows(rowPayloads);
    const actor = importedBy(auth);

    const { data: batch, error: batchError } = await admin
      .from("employee_import_batches")
      .insert({
        organization_id: organizationId,
        source_file_name: file.name,
        source_file_size: file.size,
        source_file_hash: workbookHash(buffer),
        source_sheet_name: parsed.sheetName,
        status: summary.invalid > 0 ? "validated" : "ready",
        mapping,
        summary,
        notes: skippedRows > 0 ? `${skippedRows} summary/footer row(s) skipped during staging.` : null,
        created_by: auth.user.id,
        created_by_name: actor.name,
        created_by_email: actor.email,
        updated_by: auth.user.id,
        updated_by_name: actorName(auth),
        updated_by_email: auth.user.email || null,
      })
      .select("*")
      .single();

    if (batchError) throw batchError;

    if (rowPayloads.length > 0) {
      const { error: rowsError } = await admin.from("employee_import_rows").insert(
        rowPayloads.map((row) => ({ ...row, batch_id: batch.id })),
      );
      if (rowsError) throw rowsError;
    }

    return NextResponse.json({
      batch,
      summary,
      headers: parsed.headers,
      parsed_rows: employeeRows.length,
      raw_rows: parsed.rows.length,
      skipped_rows: skippedRows,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to upload employee import workbook.", 500);
  }
}
