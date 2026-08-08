import { loadStandardApprovalRows, loadStandardPeriod } from "@/app/api/labour/approvals/route";
import { formatAttendanceExportTimestamp, labourAttendancePdf, labourAttendanceXlsx, sanitizeFilename } from "@/lib/labour/attendanceExport";
import { requireLabourPermission } from "@/app/api/labour/_shared";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");
    if (format !== "xlsx" && format !== "pdf") return new Response("Unsupported export format.", { status: 400 });
    let access = await requireLabourPermission(request, "labour_attendance", "view");
    if ("response" in access) access = await requireLabourPermission(request, "labour_daily_submission", "view");
    if ("response" in access) return access.response;
    const ids = (searchParams.get("period_ids") || searchParams.get("period_id") || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!ids.length) return new Response("Attendance register is required.", { status: 400 });
    const attendanceDate = String(searchParams.get("attendance_date") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) return new Response("A valid attendance date is required.", { status: 400 });
    const periods = (await Promise.all(ids.map((id) => loadStandardPeriod(access, id)))).filter(Boolean) as any[];
    if (!periods.length) return new Response("Attendance register not found.", { status: 404 });
    const first = periods[0];
    if (periods.some((period) => String(period.period_month || "").slice(0, 7) !== attendanceDate.slice(0, 7))) return new Response("Attendance date is outside the selected register period.", { status: 400 });
    const rows = await loadStandardApprovalRows(access, { organizationId: first.organization_id, companyId: first.company_id, siteId: first.site_id, periodIds: periods.map((period) => period.id), workDate: attendanceDate, status: "all", contractorProfileId: null, search: null });
    const [{ data: company }, { data: site }] = await Promise.all([
      access.admin.from("companies").select("company_name, company_code").eq("id", first.company_id).maybeSingle(),
      access.admin.from("sites").select("site_name, site_code").eq("id", first.site_id).maybeSingle(),
    ]);
    const rowStatuses = new Set(rows.map((row: any) => row.status).filter(Boolean));
    const status = rowStatuses.size === 1 ? Array.from(rowStatuses)[0] : rowStatuses.has("submitted") ? "submitted" : rowStatuses.has("reopened") ? "reopened" : rowStatuses.has("finalized") ? "finalized" : first.status;
    const context = { company_name: company?.company_name || company?.company_code || "-", site_name: site?.site_name || site?.site_code || "-", work_date: attendanceDate, status: status === "submitted" ? "Submitted" : status === "finalized" ? "Finalized" : status === "reopened" ? "Reopened" : status === "draft" ? "Draft" : status, submitted_by_name: periods.map((period) => period.submitted_by_name).filter(Boolean).join(", ") || first.submitted_by_email, submitted_at: formatAttendanceExportTimestamp(periods.map((period) => period.submitted_at).filter(Boolean).sort().reverse()[0]) };
    const body = format === "xlsx" ? labourAttendanceXlsx(context, rows) : labourAttendancePdf(context, rows);
    const extension = format === "xlsx" ? "xlsx" : "pdf";
    const filename = `Labour_Attendance_${sanitizeFilename(context.site_name)}_${context.work_date || "register"}.${extension}`;
    return new Response(body as BodyInit, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error: any) {
    return new Response(error.message || "Failed to export attendance register.", { status: 500 });
  }
}
