import { NextResponse } from "next/server";
import {
  acceptedWorkbookFile,
  assertEmployeeWorkbookColumnIntegrity,
  importedBy,
  loadImportMasterData,
  mappingFromHeaders,
  normalizedHeaderName,
  parseEmployeeWorkbook,
  isImportableEmployeeRow,
  applyExistingEmployeeStatus,
  rowPayloadForInsert,
  scopedOrganizationId,
  summarizeRows,
  workbookHash,
} from "@/lib/hr/employeeImport";
import { actorName, adminClient, jsonError, requireImportPermission } from "../_shared";

function mappingScoreForHeaders(headers: string[], mapping: Record<string, any> | null | undefined) {
  if (!mapping || typeof mapping !== "object") return 0;
  return headers.reduce((score, header) => {
    const mapped = mapping[header] || mapping[normalizedHeaderName(header)];
    return score + (typeof mapped === "string" && mapped ? 1 : 0);
  }, 0);
}

async function loadSavedMappingForWorkbook(
  admin: ReturnType<typeof adminClient>,
  organizationId: string,
  headers: string[],
  sourceFileHash: string,
  sourceFileName: string,
  sourceSheetName: string | null,
) {
  const { data: exactHashBatch, error: exactHashError } = await admin
    .from("employee_import_batches")
    .select("mapping")
    .eq("organization_id", organizationId)
    .eq("source_file_hash", sourceFileHash)
    .not("mapping", "is", null)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exactHashError) throw exactHashError;
  if (exactHashBatch && mappingScoreForHeaders(headers, exactHashBatch.mapping) > 0) {
    return exactHashBatch.mapping;
  }

  const { data: candidateBatches, error: candidateError } = await admin
    .from("employee_import_batches")
    .select("mapping, source_file_name, source_sheet_name")
    .eq("organization_id", organizationId)
    .not("mapping", "is", null)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (candidateError) throw candidateError;

  let bestMapping: Record<string, any> = {};
  let bestScore = 0;
  for (const batch of candidateBatches || []) {
    const baseScore = mappingScoreForHeaders(headers, batch.mapping);
    if (baseScore === 0) continue;
    const sameNameBonus = batch.source_file_name === sourceFileName ? 2 : 0;
    const sameSheetBonus = sourceSheetName && batch.source_sheet_name === sourceSheetName ? 1 : 0;
    const score = baseScore + sameNameBonus + sameSheetBonus;
    if (score > bestScore) {
      bestScore = score;
      bestMapping = batch.mapping || {};
    }
  }

  return bestMapping;
}

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
    assertEmployeeWorkbookColumnIntegrity(parsed);
    const admin = adminClient();
    const organizationId = await scopedOrganizationId(admin, auth, preferredOrganizationId);

    if (!organizationId) {
      return jsonError("Could not resolve an organization for this import.", 403);
    }

    const sourceFileHash = workbookHash(buffer);
    const savedMapping = await loadSavedMappingForWorkbook(
      admin,
      organizationId,
      parsed.headers,
      sourceFileHash,
      file.name,
      parsed.sheetName,
    );
    const mapping = mappingFromHeaders(parsed.headers, savedMapping);
    const masters = await loadImportMasterData(admin, auth);
    const employeeRows = parsed.rows.filter((row) => isImportableEmployeeRow(row.raw, mapping));
    const skippedRows = parsed.rows.length - employeeRows.length;
    const existingEmployeeByCode = new Map(
      (masters.employees || [])
        .filter((employee: any) => employee.organization_id === organizationId)
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
    const batchIdentityRows: any[] = [];
    const rowPayloads = employeeRows.map((row) => {
      const payload = applyExistingEmployeeStatus(
        rowPayloadForInsert(row, mapping, masters, organizationId),
        existingEmployeeByCode,
        batchIdentityRows,
      );
      if (payload.import_status === "pending" && payload.validation_status !== "invalid") {
        batchIdentityRows.push({
          id: `batch:${payload.source_row_number}`,
          organization_id: organizationId,
          company_id: payload.matched_company_id,
          site_id: payload.matched_site_id,
          employee_name: payload.normalized_data?.employee_name,
          phone: payload.normalized_data?.phone,
          personal_phone: payload.normalized_data?.personal_phone,
          email: payload.normalized_data?.email,
          personal_email: payload.normalized_data?.personal_email,
          status: payload.normalized_data?.status || "active",
        });
      }
      return payload;
    });
    const summary = summarizeRows(rowPayloads);
    const actor = importedBy(auth);

    const { data: batch, error: batchError } = await admin
      .from("employee_import_batches")
      .insert({
        organization_id: organizationId,
        source_file_name: file.name,
        source_file_size: file.size,
        source_file_hash: sourceFileHash,
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
