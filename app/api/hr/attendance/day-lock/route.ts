import { NextResponse } from "next/server";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import {
  adminClient,
  assertCanLockDate,
  jsonError,
  loadDayLock,
  requireAttendanceApprovalPermission,
  validateCompanySiteScope,
} from "../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireAttendanceApprovalPermission(request, "approve");
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const companyId = String(payload.company_id || "").trim();
    const siteId = String(payload.site_id || "").trim();
    const attendanceDate = String(payload.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) return jsonError("Valid attendance date is required.", 400);
    const lockError = assertCanLockDate(attendanceDate);
    if (lockError) return jsonError(lockError, 403);

    const admin = adminClient();
    const scope = await validateCompanySiteScope(admin, auth, companyId, siteId);
    if ("response" in scope) return scope.response;
    const existing = await loadDayLock(admin, { organizationId: scope.organizationId, companyId, siteId, attendanceDate });
    if (existing) return NextResponse.json({ day_lock: existing });

    const { data, error } = await admin
      .from("employee_attendance_day_locks")
      .upsert({
        organization_id: scope.organizationId,
        company_id: companyId,
        site_id: siteId,
        attendance_date: attendanceDate,
        is_locked: true,
        locked_by: auth.user.id,
        locked_by_name: actorName(auth.user),
        locked_by_email: auth.user.email || null,
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,company_id,site_id,attendance_date" })
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
      action: "approve",
      description: `Attendance day locked for ${attendanceDate}.`,
      oldValues: null,
      newValues: data,
      source: "system",
    }, request);

    return NextResponse.json({ day_lock: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to lock attendance day.", 500);
  }
}
