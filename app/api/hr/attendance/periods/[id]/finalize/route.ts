import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName, datesForMonth } from "@/lib/hr/attendance";
import { adminClient, assertCanFinalizeMonth, canReviewEmployeeAttendancePeriod, hasAttendanceApprovalPermission, isCurrentLevelApprover, jsonError, loadAttendanceRows, loadEligibleEmployees, nextApprovedStatusForLevel, requireAttendanceApprovalActor } from "../../../_shared";
import { loadScopedPeriod } from "../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const admin = adminClient();
    const loaded = await loadScopedPeriod(admin, auth, id);
    if ("response" in loaded) return loaded.response;
    const period = loaded.period;
    const snapshot = period.approval_workflow_snapshot || {};
    const totalLevels = Math.max(0, Math.min(3, Number(snapshot.approval_level_count ?? 1)));
    const currentLevel = Number(period.current_approval_level || 1);
    const expectedStatus = currentLevel <= 1 ? "submitted" : `level_${currentLevel - 1}_approved`;
    if (totalLevels <= 0) return jsonError("This period does not require approval.", 403);
    if (period.status !== expectedStatus) return jsonError("This attendance period is not waiting at your approval level.", 403);
    if (!canReviewEmployeeAttendancePeriod(auth, period) && !hasAttendanceApprovalPermission(auth, "approve")) {
      return jsonError("Only the configured current-level approver can approve this period.", 403);
    }
    if (!isCurrentLevelApprover(auth, snapshot, currentLevel)) return jsonError("Only the configured current-level approver can approve this period.", 403);
    const finalizeError = assertCanFinalizeMonth(period.period_month);
    if (finalizeError) return jsonError(finalizeError, 403);
    const dates = datesForMonth(period.period_month);
    const [employees, rows] = await Promise.all([
      loadEligibleEmployees(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: dates[0], endDate: dates[dates.length - 1] }),
      loadAttendanceRows(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: dates[0], endDate: dates[dates.length - 1] }),
    ]);
    const summary = { total_recorded: rows.length, missing: Math.max(0, employees.length * dates.length - rows.length) };
    const nextStatus = nextApprovedStatusForLevel(currentLevel, totalLevels);
    const { data, error } = await admin
      .from("employee_attendance_periods")
      .update({
        status: nextStatus,
        current_approval_level: nextStatus === "finalized" ? null : currentLevel + 1,
        finalized_by: nextStatus === "finalized" ? auth.user.id : period.finalized_by,
        finalized_by_name: nextStatus === "finalized" ? actorName(auth.user) : period.finalized_by_name,
        finalized_by_email: nextStatus === "finalized" ? auth.user.email || null : period.finalized_by_email,
        finalized_at: nextStatus === "finalized" ? new Date().toISOString() : period.finalized_at,
        summary,
        updated_by: auth.user.id,
        updated_by_name: actorName(auth.user),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id)
      .select("*")
      .single();
    if (error) throw error;
    await insertErpAuditLog(admin, auth.user, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      moduleCode: "hr_attendance_approval",
      entityType: "employee_attendance_period",
      recordId: period.id,
      action: "approve",
      description: nextStatus === "finalized" ? "Attendance period finalized." : `Attendance period approved at Level ${currentLevel}.`,
      oldValues: period,
      newValues: data,
      source: "system",
    }, request);
    return Response.json({ period: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to finalize attendance period.", 500);
  }
}
