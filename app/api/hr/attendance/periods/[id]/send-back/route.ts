import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import { adminClient, canReviewEmployeeAttendancePeriod, hasAttendanceApprovalPermission, isCurrentLevelApprover, jsonError, requireAttendanceApprovalActor } from "../../../_shared";
import { loadScopedPeriod } from "../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const reason = String(payload.reason || "").trim();
    if (reason.length < 10) return jsonError("Enter a send-back reason of at least 10 characters.", 400);
    const { id } = await params;
    const admin = adminClient();
    const loaded = await loadScopedPeriod(admin, auth, id);
    if ("response" in loaded) return loaded.response;
    const period = loaded.period;
    const snapshot = period.approval_workflow_snapshot || {};
    const currentLevel = Number(period.current_approval_level || 1);
    const reviewStatuses = ["submitted", "level_1_approved", "level_2_approved"];
    if (!reviewStatuses.includes(period.status)) return jsonError("Only periods pending approval can be sent back.", 403);
    if (!canReviewEmployeeAttendancePeriod(auth, period) && !hasAttendanceApprovalPermission(auth, "reject")) {
      return jsonError("Only the configured current-level approver can send back this period.", 403);
    }
    if (!isCurrentLevelApprover(auth, snapshot, currentLevel)) return jsonError("Only the configured current-level approver can send back this period.", 403);
    const { data, error } = await admin
      .from("employee_attendance_periods")
      .update({
        status: "reopened",
        current_approval_level: null,
        send_back_reason: reason,
        reopened_by: auth.user.id,
        reopened_by_name: actorName(auth.user),
        reopened_by_email: auth.user.email || null,
        reopened_at: new Date().toISOString(),
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
      action: "reject",
      description: "Attendance period sent back for correction.",
      oldValues: period,
      newValues: data,
      source: "system",
    }, request);
    return Response.json({ period: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to send back attendance period.", 500);
  }
}
