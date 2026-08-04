import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName, datesForMonth } from "@/lib/hr/attendance";
import { adminClient, jsonError, loadAttendanceRows, loadEligibleEmployees, loadEmployeeAttendancePolicyForScope, policySnapshot, requireAttendancePermission } from "../../../_shared";
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
    if (!["draft", "reopened"].includes(period.status)) return jsonError("Only draft or reopened periods can be submitted.", 403);
    const dates = datesForMonth(period.period_month);
    const [employees, rows, policy] = await Promise.all([
      loadEligibleEmployees(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: dates[0], endDate: dates[dates.length - 1] }),
      loadAttendanceRows(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, startDate: dates[0], endDate: dates[dates.length - 1] }),
      loadEmployeeAttendancePolicyForScope(admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id }),
    ]);
    const summary = { total_recorded: rows.length, missing: Math.max(0, employees.length * dates.length - rows.length) };
    const snapshot = policySnapshot(policy);
    const approvalLevelCount = Number(snapshot.approval_level_count || 0);
    const { data, error } = await admin
      .from("employee_attendance_periods")
      .update({
        status: approvalLevelCount === 0 ? "finalized" : "submitted",
        submitted_by: auth.user.id,
        submitted_by_name: actorName(auth.user),
        submitted_by_email: auth.user.email || null,
        submitted_at: new Date().toISOString(),
        finalized_by: approvalLevelCount === 0 ? auth.user.id : null,
        finalized_by_name: approvalLevelCount === 0 ? actorName(auth.user) : null,
        finalized_by_email: approvalLevelCount === 0 ? auth.user.email || null : null,
        finalized_at: approvalLevelCount === 0 ? new Date().toISOString() : null,
        approval_workflow_version: snapshot.approval_workflow_version,
        approval_workflow_snapshot: snapshot,
        current_approval_level: approvalLevelCount === 0 ? null : 1,
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
      moduleCode: "hr_attendance",
      entityType: "employee_attendance_period",
      recordId: period.id,
      action: "manual_event",
      description: approvalLevelCount === 0 ? "Attendance period submitted and finalized without approval levels." : "Attendance period submitted.",
      oldValues: period,
      newValues: data,
      source: "system",
    }, request);
    return Response.json({ period: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit attendance period.", 500);
  }
}
