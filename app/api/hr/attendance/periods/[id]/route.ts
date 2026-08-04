import { NextResponse } from "next/server";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { actorName } from "@/lib/hr/attendance";
import { adminClient, jsonError } from "../../_shared";
import { loadScopedPeriod } from "./_shared";
import { requirePermission } from "@/lib/serverPermissions";

function isMissingTable(error: any) {
  return error?.code === "42P01" || /does not exist|schema cache/i.test(error?.message || "");
}

async function countOptionalDependency(admin: any, table: string, column: string, values: string[]) {
  if (!values.length) return 0;
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).in(column, values);
  if (error && isMissingTable(error)) return 0;
  if (error) throw error;
  return count || 0;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "hr_attendance_approval", "view");
    if ("response" in auth) return auth.response;
    if (!auth.roleCodes.includes("platform_owner")) return jsonError("Only Platform Owner can delete attendance.", 403);

    const { reason } = await request.json().catch(() => ({}));
    const deletionReason = String(reason || "").trim();
    if (deletionReason.length < 10) return jsonError("Deletion reason must be at least 10 characters.", 400);

    const { id } = await params;
    const admin = adminClient();
    const loaded = await loadScopedPeriod(admin, auth, id);
    if ("response" in loaded) return loaded.response;
    const period = loaded.period;

    const { data: attendanceRows, error: attendanceError } = await admin
      .from("employee_attendance")
      .select("id, employee_id, attendance_date, status")
      .eq("period_id", id);
    if (attendanceError) throw attendanceError;
    const attendanceIds = (attendanceRows || []).map((row: any) => row.id).filter(Boolean);
    const dependentPayrollRows =
      await countOptionalDependency(admin, "employee_salary_attendance_lines", "attendance_id", attendanceIds) +
      await countOptionalDependency(admin, "employee_payroll_attendance_lines", "attendance_id", attendanceIds);
    if (dependentPayrollRows > 0) {
      return jsonError("This attendance period is already used for salary or payroll processing and cannot be deleted.", 409);
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      moduleCode: "hr_attendance_approval",
      entityType: "employee_attendance_period",
      recordId: period.id,
      action: "delete",
      description: "Platform Owner deleted employee attendance period.",
      oldValues: { period, attendance_rows: attendanceRows || [] },
      newValues: { reason: deletionReason, deleted_by: actorName(auth.user), deleted_at: new Date().toISOString() },
      source: "manual",
    }, request);

    if (attendanceIds.length) {
      const { error } = await admin.from("employee_attendance").delete().in("id", attendanceIds);
      if (error) throw error;
    }
    const { error: periodError } = await admin.from("employee_attendance_periods").delete().eq("id", id);
    if (periodError) throw periodError;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete attendance period.", 500);
  }
}
