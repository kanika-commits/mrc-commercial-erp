import { NextResponse } from "next/server";
import {
  actorFields,
  jsonError,
  requireLabourPermission,
  resolveOrganizationId,
  validateLabourCompanySiteIndependent,
  validateContractorProfile,
} from "@/app/api/labour/_shared";
import { fileHash, parseLabourAttendanceWorkbook } from "@/lib/labour/import";
import { isoDate, monthStart } from "@/lib/labour/operations";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function dateFromSelectedMonth(periodMonth: string | null, day: string | undefined) {
  const month = monthStart(periodMonth);
  const dayNumber = Number(String(day || "").trim());
  if (!month || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return "";
  const candidate = `${month.slice(0, 8)}${String(dayNumber).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === candidate ? candidate : "";
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance_import", "upload");
    if ("response" in access) return access.response;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Attendance import workbook is required.");

    const organizationId = await resolveOrganizationId(access, text(formData.get("organization_id")));
    const companyId = text(formData.get("company_id"));
    const siteId = text(formData.get("site_id"));
    const contractorProfileId = text(formData.get("contractor_profile_id"));
    const selectedPeriodMonth = monthStart(formData.get("period_month"));

    if (!organizationId) return jsonError("Could not resolve an organization for this import.", 403);
    if (!companyId || !siteId) return jsonError("Company and site are required for attendance import.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const contractorCheck = await validateContractorProfile(access, organizationId, contractorProfileId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseLabourAttendanceWorkbook(buffer);
    if (parsed.format === "monthly_muster" && !selectedPeriodMonth) {
      return jsonError("Month is required for monthly muster attendance imports.");
    }
    if (!parsed.rows.length) return jsonError("No attendance rows were found in the workbook.");

    const { data: batch, error: batchError } = await access.admin
      .from("labour_attendance_import_batches")
      .insert({
        organization_id: organizationId,
        selected_company_id: companyId,
        selected_site_id: siteId,
        selected_contractor_profile_id: contractorProfileId,
        selected_period_month: selectedPeriodMonth,
        import_format: parsed.format,
        source_file_name: file.name,
        source_file_hash: fileHash(buffer),
        source_file_size: file.size,
        source_sheet_name: parsed.sheetName,
        status: "uploaded",
        summary: { total_rows: parsed.rows.length, format: parsed.format },
        ...actorFields(access.auth, "created"),
      })
      .select("id")
      .single();
    if (batchError) throw batchError;

    const rows = parsed.rows.map((row) => {
      const attendanceDate =
        isoDate(row.normalized.attendance_date) ||
        dateFromSelectedMonth(selectedPeriodMonth, row.sourceColumn);
      const normalized = { ...row.normalized, attendance_date: attendanceDate };
      return {
        batch_id: batch.id,
        organization_id: organizationId,
        source_row_number: row.sourceRowNumber,
        source_column: row.sourceColumn || null,
        raw_data: row.raw,
        normalized_data: normalized,
        labour_code: normalized.labour_code || null,
        worker_name: normalized.worker_name || null,
        attendance_date: attendanceDate || null,
        attendance_code: normalized.attendance_code || null,
      };
    });

    const { error: rowError } = await access.admin.from("labour_attendance_import_rows").insert(rows);
    if (rowError) throw rowError;

    return NextResponse.json({
      batch_id: batch.id,
      rows: rows.length,
      sheet_name: parsed.sheetName,
      format: parsed.format,
      headers: parsed.headers,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to upload labour attendance import workbook.", 500);
  }
}
