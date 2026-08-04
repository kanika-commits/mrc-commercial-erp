import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName, isAdminRecoveryRole } from "@/lib/hr/attendance";
import { adminClient, jsonError, requireAttendanceApprovalPermission } from "../../../_shared";
import { loadScopedPeriod } from "../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAttendanceApprovalPermission(request, "approve");
    if ("response" in auth) return auth.response;
    if (!isAdminRecoveryRole(auth.roleCodes)) return jsonError("Only Platform Owner or Super Admin can reopen finalized attendance.", 403);
    const payload = await request.json().catch(() => ({}));
    const reason = String(payload.reason || "").trim();
    if (!reason) return jsonError("Reopen reason is required.", 400);
    const { id } = await params;
    const admin = adminClient();
    const loaded = await loadScopedPeriod(admin, auth, id);
    if ("response" in loaded) return loaded.response;
    const period = loaded.period;
    if (period.status !== "finalized") return jsonError("Only finalized periods can be reopened.", 403);
    const { data, error } = await admin
      .from("employee_attendance_periods")
      .update({
        status: "reopened",
        reopened_by: auth.user.id,
        reopened_by_name: actorName(auth.user),
        reopened_by_email: auth.user.email || null,
        reopened_at: new Date().toISOString(),
        reopen_reason: reason,
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
      action: "manual_event",
      description: "Finalized attendance period reopened.",
      oldValues: period,
      newValues: data,
      source: "system",
    }, request);
    return Response.json({ period: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to reopen attendance period.", 500);
  }
}
