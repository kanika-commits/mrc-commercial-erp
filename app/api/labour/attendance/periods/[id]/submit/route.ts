import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, jsonError, originatingAttendanceSystem, requireLabourPermission } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { isoDate } from "@/lib/labour/operations";

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
    const access = await requireLabourPermission(request, "labour_attendance", "submit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const period = await loadPeriod(access, id);
    if (!period) return jsonError("Attendance period not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const attendanceDate = isoDate(payload.attendance_date);
    const workflow = originatingAttendanceSystem(period.originating_attendance_system);
    if (!workflow) return jsonError("This attendance period has no originating attendance workflow. Confirm the historical workflow before submitting it.", 409);
    if (workflow === "site_in_engineer") return jsonError("This attendance period belongs to Site-In & Engineer Daily Labour. Use Engineer Daily Labour for this existing record.", 403);
    if (attendanceDate) {
      const selectedStatus = period.summary?.date_statuses?.[attendanceDate]?.status || period.status;
      if (!["draft", "reopened"].includes(selectedStatus)) return jsonError("Only draft attendance can be submitted for this date.");
      const now = new Date().toISOString();
      const nextSummary = {
        ...(period.summary || {}),
        date_statuses: {
          ...(period.summary?.date_statuses || {}),
          [attendanceDate]: {
            ...(period.summary?.date_statuses?.[attendanceDate] || {}),
            status: "submitted",
            submitted_at: now,
            submitted_by: access.auth.user.id,
          },
        },
      };
      const { error } = await access.admin
        .from("labour_attendance_periods")
        .update({
          summary: nextSummary,
          submitted_at: now,
          submitted_by: access.auth.user.id,
          submitted_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
          submitted_by_email: access.auth.user.email || null,
          updated_at: now,
          ...actorFields(access.auth, "updated"),
        })
        .eq("id", id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_attendance",
        action: "approve",
        entityType: "labour_attendance_period",
        recordId: id,
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        description: `Submitted labour attendance for ${attendanceDate}.`,
        oldValues: { status: selectedStatus, summary: period.summary },
        newValues: { attendance_date: attendanceDate, status: "submitted", summary: nextSummary },
      });
      return NextResponse.json({ submitted: true });
    }
    if (!["draft", "reopened"].includes(period.status)) return jsonError("Only draft attendance periods can be submitted.");
    const updatePayload = {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "submitted" as any),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_attendance_periods").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_attendance",
      action: "approve",
      entityType: "labour_attendance_period",
      recordId: id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Submitted labour attendance period.",
      oldValues: period,
      newValues: updatePayload,
    });
    return NextResponse.json({ submitted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit attendance period.", 500);
  }
}
