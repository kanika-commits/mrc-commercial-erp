import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import { adminClient, assertDateSelectable, ensureDailySubmission, isExactReopenedDailySubmission, jsonError, loadActiveHistoricalAttendanceAccess, loadAttendanceRows, loadEligibleEmployees, loadEmployeeAttendancePolicyForScope, loadDailySubmission, requireAttendancePermission } from "../../../_shared";
import { loadScopedPeriod } from "../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAttendancePermission(request, "submit");
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const admin = adminClient();
    const loaded = await loadScopedPeriod(admin, auth, id);
    if ("response" in loaded) return loaded.response;
    const period = loaded.period;
    const payload = await request.json().catch(() => ({}));
    const attendanceDate = String(payload.attendance_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !attendanceDate.startsWith(String(period.period_month).slice(0, 7))) return jsonError("A valid attendance date in the selected period is required.", 400);
    const dailySubmission = await loadDailySubmission(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, attendanceDate });
    const historicalAccess = await loadActiveHistoricalAttendanceAccess(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, attendanceDate, attendanceType: "employee" });
    const returnedDate = isExactReopenedDailySubmission(dailySubmission, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, attendanceDate });
    const dateAllowed = assertDateSelectable(auth, attendanceDate, Boolean(historicalAccess), returnedDate);
    if (!dateAllowed.allowed) return jsonError(("error" in dateAllowed ? dateAllowed.error : undefined) || "Attendance date cannot be submitted.", 403);
    if (dailySubmission && !["draft", "reopened"].includes(String(dailySubmission.status || "").toLowerCase())) return jsonError("This attendance date is already submitted or approved.", 403);
    const [employees, rows, policy] = await Promise.all([
      loadEligibleEmployees(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: attendanceDate, endDate: attendanceDate }),
      loadAttendanceRows(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: attendanceDate, endDate: attendanceDate }),
      loadEmployeeAttendancePolicyForScope(admin, { organizationId: period.organization_id, siteId: period.site_id }),
    ]);
    if (!policy) return jsonError("Employee Attendance Policy is not configured for the selected site.", 409);
    if (!rows.length) return jsonError("Save attendance before submitting this date.", 400);
    const daily = await ensureDailySubmission(admin, auth, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, periodId: period.id, attendanceDate });
    const now = new Date().toISOString();
    const { data, error } = await admin.from("employee_attendance_daily_submissions").update({
        status: "submitted",
        submitted_by: auth.user.id,
        submitted_by_name: actorName(auth.user),
        submitted_by_email: auth.user.email || null,
        submitted_at: now,
        updated_by: auth.user.id,
        updated_by_name: actorName(auth.user),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", daily.id)
      .select("*")
      .single();
    if (error) throw error;
    await insertErpAuditLog(admin, auth.user, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      moduleCode: "hr_attendance",
      entityType: "employee_attendance_daily_submission",
      recordId: data.id,
      action: "manual_event",
      description: "Daily attendance submitted for approval.",
      oldValues: daily,
      newValues: data,
      source: "system",
    }, request);
    return Response.json({ period, daily_submission: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit attendance period.", 500);
  }
}
