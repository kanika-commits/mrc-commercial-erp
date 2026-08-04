import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, isGlobalOrSuperAdmin, jsonError, originatingAttendanceSystem, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

async function loadPeriod(access: any, id: string) {
  let query = access.admin.from("labour_attendance_periods").select("*").eq("id", id);
  const orgScoped = applyOrganizationScope(query, access.organizationScope);
  if (!orgScoped) return null;
  query = applyCompanySiteScope(orgScoped, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_daily_submission", "final_override");
    if ("response" in access) return access.response;
    if (!isGlobalOrSuperAdmin(access)) return jsonError("Only Platform Owner or Super Admin can reopen attendance periods.", 403);
    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const reason = normalizeText(payload.reason);
    if (!reason) return jsonError("Reopen reason is required.");
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Attendance period not found.", 404);
    const workflow = originatingAttendanceSystem(period.originating_attendance_system);
    if (!workflow) return jsonError("This attendance period has no originating attendance workflow. Confirm the historical workflow before reopening it.", 409);
    if (workflow !== "standard") return jsonError("This approval action is available only for Standard Attendance records.", 403);
    const { data: wagePeriod, error: wageError } = await access.admin.from("labour_wage_periods").select("id, status").eq("attendance_period_id", id).maybeSingle();
    if (wageError) throw wageError;
    if (wagePeriod?.status === "finalized") return jsonError("Reopen the finalized wage period before reopening attendance.");
    const updatePayload = {
      status: "reopened",
      reopened_at: new Date().toISOString(),
      transition_reason: reason,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "reopened" as any),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_attendance_periods").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_daily_submission",
      action: "reject",
      entityType: "labour_attendance_period",
      recordId: id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Reopened labour attendance period.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ reopened: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to reopen attendance period.", 500);
  }
}
