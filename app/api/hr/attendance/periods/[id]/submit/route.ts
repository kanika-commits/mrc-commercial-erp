import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import { adminClient, jsonError, requireAttendancePermission } from "../../../_shared";
import { loadScopedPeriod } from "../_shared";
import { notifyWorkflowRecipients, approvalLayerRecipientIds } from "@/lib/notificationWorkflow.server";

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
    const { data, error } = await admin.rpc("submit_hr_employee_attendance_atomic", {
      p_organization_id: period.organization_id,
      p_company_id: period.company_id,
      p_site_id: period.site_id,
      p_period_id: period.id,
      p_attendance_date: attendanceDate,
      p_actor_id: auth.user.id,
      p_actor_name: actorName(auth.user),
      p_actor_email: auth.user.email || null,
    });
    if (error) {
      if (error.code === "P0010") return jsonError(error.message, 403);
      if (["P0008", "P0012"].includes(error.code)) return jsonError(error.message, 409);
      if (["P0011", "P0013"].includes(error.code)) return jsonError(error.message, 400);
      throw error;
    }
    const daily = data as any;
    await insertErpAuditLog(admin, auth.user, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      moduleCode: "hr_attendance",
      entityType: "employee_attendance_daily_submission",
      recordId: daily.id,
      action: "manual_event",
      description: "Daily attendance submitted for approval.",
      oldValues: null,
      newValues: daily,
      source: "system",
    }, request);
    await notifyWorkflowRecipients(admin, {
      eventType: "employee_attendance_awaiting_approval",
      entityType: "employee_attendance_daily_submission",
      entityId: daily.id,
      cycleId: String(daily.submission_version || daily.submitted_at || daily.id),
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      title: "Employee Attendance awaiting approval",
      message: `Employee attendance for ${period.site_name || "the selected site"} on ${attendanceDate} is waiting for your approval.`,
      targetUrl: `/hr/attendance-approval?period_id=${encodeURIComponent(period.id)}`,
      recipientIds: approvalLayerRecipientIds(period.approval_workflow_snapshot, 1),
      actorId: auth.user.id,
      stage: 1,
      requiredPermission: { moduleCode: "hr_attendance_approval", actionCode: "approve" },
    });
    return Response.json({ period, daily_submission: daily });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit attendance period.", 500);
  }
}
