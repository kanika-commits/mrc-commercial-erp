import { NextResponse } from "next/server";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName, isAdminRecoveryRole } from "@/lib/hr/attendance";
import {
  adminClient,
  jsonError,
  loadDayLock,
  requireAttendanceApprovalPermission,
  validateCompanySiteScope,
} from "../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireAttendanceApprovalPermission(request, "approve");
    if ("response" in auth) return auth.response;
    if (!isAdminRecoveryRole(auth.roleCodes)) return jsonError("Only Platform Owner or Super Admin can unlock attendance.", 403);

    const payload = await request.json().catch(() => ({}));
    const reason = String(payload.reason || "").trim();
    const companyId = String(payload.company_id || "").trim();
    const siteId = String(payload.site_id || "").trim();
    const attendanceDate = String(payload.date || "").trim();
    if (!reason) return jsonError("Unlock reason is required.", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) return jsonError("Valid attendance date is required.", 400);

    const admin = adminClient();
    const scope = await validateCompanySiteScope(admin, auth, companyId, siteId);
    if ("response" in scope) return scope.response;
    const existing = await loadDayLock(admin, { organizationId: scope.organizationId, companyId, siteId, attendanceDate });
    if (!existing) return jsonError("Attendance day is not locked.", 404);

    const { data, error } = await admin
      .from("employee_attendance_day_locks")
      .update({
        is_locked: false,
        unlocked_by: auth.user.id,
        unlocked_by_name: actorName(auth.user),
        unlocked_by_email: auth.user.email || null,
        unlocked_at: new Date().toISOString(),
        unlock_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: scope.organizationId,
      companyId,
      siteId,
      moduleCode: "hr_attendance_approval",
      entityType: "employee_attendance_day_lock",
      recordId: data.id,
      action: "manual_event",
      description: `Attendance day unlocked for ${attendanceDate}.`,
      oldValues: existing,
      newValues: data,
      source: "system",
    }, request);

    return NextResponse.json({ day_lock: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to unlock attendance day.", 500);
  }
}
