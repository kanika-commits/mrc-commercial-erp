import { enrichStandardSubmitterSnapshots, loadApprovedStandardMonthlyRegister, loadStandardApprovalRows, loadStandardPeriod } from "@/app/api/labour/approvals/route";
import { formatAttendanceExportTimestamp, labourAttendancePdf, labourAttendanceXlsx, labourMonthlyAttendancePdf, sanitizeFilename } from "@/lib/labour/attendanceExport";
import { requireLabourPermission, validateLabourOperationalCompanySite } from "@/app/api/labour/_shared";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");
    if (format !== "xlsx" && format !== "pdf") return new Response("Unsupported export format.", { status: 400 });
    const access = await requireLabourPermission(request, "labour_daily_submission", "view");
    if ("response" in access) return access.response;
    if (searchParams.get("view") === "monthly") {
      const companyId = String(searchParams.get("company_id") || "");
      const siteId = String(searchParams.get("site_id") || "");
      const month = String(searchParams.get("month") || "");
      if (!companyId || !siteId || !/^\d{4}-\d{2}$/.test(month)) return new Response("Company, site and month are required.", { status: 400 });
      const requestedOrganizationId = access.organizationScope?.[0] || searchParams.get("organization_id");
      const scopeCheck = await validateLabourOperationalCompanySite(access, requestedOrganizationId, companyId, siteId);
      if ("error" in scopeCheck) return new Response(scopeCheck.error || "Selected company/site is not available.", { status: 403 });
      const result = await loadApprovedStandardMonthlyRegister(access, { organizationId: scopeCheck.organizationId, companyId, siteId, month, contractorProfileId: searchParams.get("contractor_profile_id"), category: searchParams.get("category"), attendanceStatus: searchParams.get("attendance_status"), search: searchParams.get("search") });
      const [{ data: company }, { data: site }] = await Promise.all([
        access.admin.from("companies").select("company_name, company_code").eq("id", companyId).maybeSingle(),
        access.admin.from("sites").select("site_name, site_code").eq("id", siteId).maybeSingle(),
      ]);
      const context = { company_name: company?.company_name || company?.company_code || "-", site_name: site?.site_name || site?.site_code || "-", month, financial_complete: result.financial_complete, unverified_rows: result.unverified_rows, grand_totals: result.grand_totals, contractors: result.contractors, legacy_dates: result.legacy_dates || [] };
      const body = labourMonthlyAttendancePdf(context, result.rows);
      return new Response(body as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Labour_Monthly_Attendance_${sanitizeFilename(context.site_name)}_${month}.pdf"`, "Cache-Control": "no-store" } });
    }
    const ids = (searchParams.get("period_ids") || searchParams.get("period_id") || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!ids.length) return new Response("Attendance register is required.", { status: 400 });
    const attendanceDate = String(searchParams.get("attendance_date") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) return new Response("A valid attendance date is required.", { status: 400 });
    const loadedPeriods = (await Promise.all(ids.map((id) => loadStandardPeriod(access, id)))).filter(Boolean) as any[];
    const periods = await enrichStandardSubmitterSnapshots(access, loadedPeriods);
    if (!periods.length) return new Response("Attendance register not found.", { status: 404 });
    const first = periods[0];
    if (periods.some((period) => String(period.period_month || "").slice(0, 7) !== attendanceDate.slice(0, 7))) return new Response("Attendance date is outside the selected register period.", { status: 400 });
    const rows = await loadStandardApprovalRows(access, { organizationId: first.organization_id, companyId: first.company_id, siteId: first.site_id, periodIds: periods.map((period) => period.id), workDate: attendanceDate, status: "all", contractorProfileId: null, search: null });
    const [{ data: company }, { data: site }] = await Promise.all([
      access.admin.from("companies").select("company_name, company_code").eq("id", first.company_id).maybeSingle(),
      access.admin.from("sites").select("site_name, site_code").eq("id", first.site_id).maybeSingle(),
    ]);
    const dateStatuses = periods.map((period) => period.summary?.date_statuses?.[attendanceDate]).filter(Boolean);
    const statusSet = new Set(dateStatuses.map((entry: any) => entry.status).filter(Boolean));
    const status = statusSet.size === 1 ? Array.from(statusSet)[0] : statusSet.has("submitted") ? "submitted" : statusSet.has("reopened") ? "reopened" : statusSet.has("finalized") ? "finalized" : "draft";
    const submitters = dateStatuses.map((entry: any) => entry.submitted_by_name || entry.submitted_by_email).filter(Boolean);
    const submittedTimes = dateStatuses.map((entry: any) => entry.submitted_at).filter(Boolean).sort().reverse();
    const context = { company_name: company?.company_name || company?.company_code || "-", site_name: site?.site_name || site?.site_code || "-", work_date: attendanceDate, status: status === "submitted" ? "Submitted" : status === "finalized" ? "Finalized" : status === "reopened" ? "Reopened" : "Draft", submitted_by_name: submitters.join(", ") || "Not Submitted", submitted_at: submittedTimes.length ? formatAttendanceExportTimestamp(submittedTimes[0]) : "Not Submitted" };
    const body = format === "xlsx" ? labourAttendanceXlsx(context, rows) : labourAttendancePdf(context, rows);
    const extension = format === "xlsx" ? "xlsx" : "pdf";
    const filename = `Labour_Attendance_${sanitizeFilename(context.site_name)}_${context.work_date || "register"}.${extension}`;
    return new Response(body as BodyInit, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error: any) {
    return new Response(error.message || "Failed to export attendance register.", { status: 500 });
  }
}
