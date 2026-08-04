import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, jsonError, originatingAttendanceSystem, requireLabourPermission } from "@/app/api/labour/_shared";
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
    const access = await requireLabourPermission(request, "labour_daily_submission", "pm_send_back");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const reason = normalizeText(payload.reason);
    if (!reason || reason.length < 10) return jsonError("Enter a send-back reason of at least 10 characters.");
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Attendance period not found.", 404);
    const workflow = originatingAttendanceSystem(period.originating_attendance_system);
    if (!workflow) return jsonError("This attendance period has no originating attendance workflow. Confirm the historical workflow before sending it back.", 409);
    if (workflow !== "standard") return jsonError("This approval action is available only for Standard Attendance records.", 403);
    if (period.status !== "submitted") return jsonError("Only submitted attendance periods can be sent back.");
    const updatePayload = {
      status: "reopened",
      transition_reason: reason,
      updated_at: new Date().toISOString(),
      reopened_at: new Date().toISOString(),
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
      description: "Sent labour attendance period back for correction.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ sent_back: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to send back attendance period.", 500);
  }
}
