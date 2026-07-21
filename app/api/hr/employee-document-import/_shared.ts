import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  DOCUMENT_IMPORT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_IMPORT_TYPES,
  HR_EMPLOYEE_DOCUMENT_IMPORT_MODULE,
  extractGoogleDriveFileId,
  normalizeText,
  summarizeDocumentImportRows,
} from "@/lib/hr/employeeDocumentImport";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireDocumentImportPermission(request: Request, action: string) {
  return requirePermission(request, HR_EMPLOYEE_DOCUMENT_IMPORT_MODULE, action);
}

export function actorName(auth: ServerPermissionContext) {
  return auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email || "HR User";
}

function employeeMatchKey(employeeName: unknown, fatherName: unknown) {
  return `${normalizeText(employeeName)}||${normalizeText(fatherName)}`;
}

function sourceFatherName(row: any) {
  return row?.document_metadata?.source_father_name || "";
}

export async function loadScopedBatch(
  admin: ReturnType<typeof adminClient>,
  batchId: string,
  auth: ServerPermissionContext,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin
    .from("employee_document_import_batches")
    .select("*")
    .eq("id", batchId);

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return { response: jsonError("Document import batch was not found.", 404) } as const;
  query = scopedQuery;

  const { data: batch, error } = await query.maybeSingle();
  if (error) throw error;
  if (!batch) return { response: jsonError("Document import batch was not found.", 404) } as const;
  return { batch } as const;
}

export async function validateSelectedSite(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  companyId: string,
  siteId: string,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  if (!companyId) return { error: "Company is required.", status: 400 } as const;
  if (!siteId) return { error: "Site is required.", status: 400 } as const;

  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    admin.from("companies").select("id, organization_id, status").eq("id", companyId).neq("status", "deleted").maybeSingle(),
    admin.from("sites").select("id, organization_id, company_id, status").eq("id", siteId).neq("status", "deleted").maybeSingle(),
  ]);

  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company) return { error: "Selected company was not found.", status: 404 } as const;
  if (!site) return { error: "Selected site was not found.", status: 404 } as const;
  if (!isInOrganizationScope(organizationScope, company.organization_id)) {
    return { error: "Selected company is not available for this organization.", status: 403 } as const;
  }
  if (site.organization_id !== company.organization_id || site.company_id !== companyId) {
    return { error: "Selected site is not available for this company.", status: 403 } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const { data: assignments, error } = await admin
      .from("user_access_assignments")
      .select("company_id, site_id")
      .eq("user_id", auth.user.id);
    if (error) throw error;
    const siteIds = new Set((assignments || []).map((row: any) => row.site_id).filter(Boolean));
    const companyIds = new Set((assignments || []).map((row: any) => row.company_id).filter(Boolean));
    if (siteIds.size > 0 && !siteIds.has(siteId)) {
      return { error: "Selected site is not available for this user.", status: 403 } as const;
    }
    if (siteIds.size === 0 && companyIds.size > 0 && !companyIds.has(companyId)) {
      return { error: "Selected company is not available for this user.", status: 403 } as const;
    }
  }

  return { organizationId: company.organization_id as string } as const;
}

export async function loadScopedImportRow(
  admin: ReturnType<typeof adminClient>,
  rowId: string,
  batchId: string,
  auth: ServerPermissionContext,
) {
  const batchResult = await loadScopedBatch(admin, batchId, auth);
  if ("response" in batchResult) return batchResult;

  const { data: row, error } = await admin
    .from("employee_document_import_rows")
    .select("*")
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { response: jsonError("Document import row was not found.", 404) } as const;
  return { batch: batchResult.batch, row } as const;
}

export async function validateRowsForBatch(
  admin: ReturnType<typeof adminClient>,
  batch: any,
) {
  const { data: selectedSite, error: selectedSiteError } = await admin
    .from("sites")
    .select("site_name, site_code")
    .eq("id", batch.site_id)
    .maybeSingle();
  if (selectedSiteError) throw selectedSiteError;

  const { data: rows, error: rowError } = await admin
    .from("employee_document_import_rows")
    .select("*")
    .eq("batch_id", batch.id)
    .order("source_row_number");
  if (rowError) throw rowError;

  const { data: employees, error: employeeError } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, employee_code, employee_name, father_name, status")
    .eq("organization_id", batch.organization_id)
    .eq("company_id", batch.company_id)
    .eq("site_id", batch.site_id)
    .neq("status", "deleted");
  if (employeeError) throw employeeError;

  const employeesByNameAndFather = new Map<string, any[]>();
  for (const employee of employees || []) {
    const key = employeeMatchKey(employee.employee_name, employee.father_name);
    employeesByNameAndFather.set(key, [...(employeesByNameAndFather.get(key) || []), employee]);
  }
  const matchEmployees = (row: any) => employeesByNameAndFather.get(employeeMatchKey(row.employee_name, sourceFatherName(row))) || [];
  const fileIdCounts = new Map<string, number>();
  for (const row of rows || []) {
    const fileId = row.drive_file_id || extractGoogleDriveFileId(row.source_drive_url);
    if (fileId) fileIdCounts.set(fileId, (fileIdCounts.get(fileId) || 0) + 1);
  }

  const matchedRows = (rows || []).map((row: any) => {
    const matches = matchEmployees(row);
    const employee = matches.length === 1 ? matches[0] : null;
    const driveFileId = row.drive_file_id || extractGoogleDriveFileId(row.source_drive_url);
    return { row, employee, driveFileId };
  });
  const matchedEmployeeIds = Array.from(new Set(matchedRows.map((item) => item.employee?.id).filter(Boolean)));
  const matchedDocumentTypes = Array.from(new Set(matchedRows.map((item) => item.row.document_type).filter(Boolean)));
  const matchedDriveFileIds = Array.from(new Set(matchedRows.map((item) => item.driveFileId).filter(Boolean)));

  const [activeDocsResult, importedRowsResult] = await Promise.all([
    matchedEmployeeIds.length && matchedDocumentTypes.length
      ? admin
          .from("employee_documents")
          .select("id, employee_id, document_type")
          .in("employee_id", matchedEmployeeIds)
          .in("document_type", matchedDocumentTypes)
          .eq("is_active", true)
      : { data: [], error: null },
    matchedEmployeeIds.length && matchedDriveFileIds.length
      ? admin
          .from("employee_document_import_rows")
          .select("id, matched_employee_id, drive_file_id")
          .in("matched_employee_id", matchedEmployeeIds)
          .in("drive_file_id", matchedDriveFileIds)
          .eq("execution_status", "imported")
      : { data: [], error: null },
  ]);
  if (activeDocsResult.error) throw activeDocsResult.error;
  if (importedRowsResult.error) throw importedRowsResult.error;

  const activeDocKeys = new Set(
    (activeDocsResult.data || []).map((document: any) => `${document.employee_id}||${document.document_type}`),
  );
  const importedFileKeys = new Map<string, Set<string>>();
  for (const importedRow of importedRowsResult.data || []) {
    const key = `${importedRow.matched_employee_id}||${importedRow.drive_file_id}`;
    importedFileKeys.set(key, new Set([...(importedFileKeys.get(key) || []), importedRow.id]));
  }

  const updates = matchedRows.map(({ row, employee, driveFileId }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const matches = matchEmployees(row);
    const existingActive = employee ? activeDocKeys.has(`${employee.id}||${row.document_type}`) : false;
    const importedFileRowIds = employee && driveFileId ? importedFileKeys.get(`${employee.id}||${driveFileId}`) : null;
    const alreadyImported = Boolean(importedFileRowIds && Array.from(importedFileRowIds).some((id) => id !== row.id));

    if (matches.length === 0) errors.push("Employee not found.");
    if (matches.length > 1) errors.push("Multiple employees found.");
    if (!driveFileId) errors.push("Missing Drive file ID.");
    if (!EMPLOYEE_DOCUMENT_IMPORT_TYPES.has(row.document_type)) errors.push("Unsupported document type.");
    if (driveFileId && (fileIdCounts.get(driveFileId) || 0) > 1) warnings.push("Duplicate Drive file ID appears in this workbook.");
    if (employee && row.employee_name && normalizeText(row.employee_name) !== normalizeText(employee.employee_name)) {
      warnings.push("Employee name differs from ERP employee name.");
    }
    const selectedSiteLabels = [selectedSite?.site_name, selectedSite?.site_code]
      .map((value) => normalizeText(value))
      .filter(Boolean);
    if (row.source_site && selectedSiteLabels.length > 0 && !selectedSiteLabels.includes(normalizeText(row.source_site))) {
      warnings.push("Workbook site text differs from selected ERP site.");
    }
    if (alreadyImported) warnings.push("Same Drive file was already imported for this employee.");
    if (existingActive && row.selected_action === "pending") {
      errors.push("Existing active document found; choose Skip or New Version.");
    }

    return {
      id: row.id,
      matched_employee_id: employee?.id || null,
      drive_file_id: driveFileId || null,
      validation_status: errors.length > 0 ? "invalid" : "ready",
      validation_errors: errors,
      validation_warnings: warnings,
      selected_action: existingActive && row.selected_action === "pending" ? "pending" : row.selected_action,
      updated_at: new Date().toISOString(),
    };
  });

  if (updates.length > 0) {
    const { error } = await admin
      .from("employee_document_import_rows")
      .upsert(updates, { onConflict: "id" });
    if (error) throw error;
  }

  const summary = summarizeDocumentImportRows(updates);
  const status = summary.invalid > 0 ? "validated" : "ready";
  const { data: updatedBatch, error: batchError } = await admin
    .from("employee_document_import_batches")
    .update({ summary, status, updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("*")
    .single();
  if (batchError) throw batchError;

  return { batch: updatedBatch, rows: updates, summary };
}
