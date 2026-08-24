import { NextResponse } from "next/server";
import { actorFields, applyCompanySiteScope, audit, isGlobalOrSuperAdmin, jsonError, loadAttendanceRowsForWorkers, loadEligibleDeployments, loadFrozenAttendanceDeploymentIds, originatingAttendanceSystem, requireLabourPermission } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { isoDate } from "@/lib/labour/operations";
import { hasActiveSiteHrAssignment } from "@/lib/serverSiteHr";

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
    if (!isGlobalOrSuperAdmin(access) && !(await hasActiveSiteHrAssignment(access.admin, { organizationId: period.organization_id, companyId: period.company_id, siteId: period.site_id, userId: access.auth.user.id }))) {
      return jsonError("You are not assigned as Site HR for this site.", 403);
    }
    const payload = await request.json().catch(() => ({}));
    const attendanceDate = isoDate(payload.attendance_date);
    const workflow = originatingAttendanceSystem(period.originating_attendance_system);
    if (!workflow) return jsonError("This attendance period has no originating attendance workflow. Confirm the historical workflow before submitting it.", 409);
    if (workflow === "site_in_engineer") return jsonError("This attendance period belongs to Site-In & Engineer Daily Labour. Use Engineer Daily Labour for this existing record.", 403);
    if (attendanceDate) {
      const selectedStatus = period.summary?.date_statuses?.[attendanceDate]?.status || "draft";
      const frozenDeploymentIds = await loadFrozenAttendanceDeploymentIds(access, period, attendanceDate, selectedStatus);
      const deployments = await loadEligibleDeployments(access, {
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        contractorProfileId: period.contractor_profile_id,
        attendanceDate,
        deploymentIds: frozenDeploymentIds,
        ignoreWorkerCreatedAt: !frozenDeploymentIds,
        allowHistoricallyInactiveWorker: true,
      });
      const workerIds = Array.from(new Set(deployments.map((deployment: any) => deployment.labour_worker_id).filter(Boolean))) as string[];
      const attendanceRows = await loadAttendanceRowsForWorkers(access, {
        periodId: period.id,
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        attendanceDate,
        workerIds,
      });
      const attendanceByWorker = new Map((attendanceRows || []).map((row: any) => [row.labour_worker_id, row]));
      const incompleteWorkers = deployments.flatMap((deployment: any) => {
        const row: any = attendanceByWorker.get(deployment.labour_worker_id);
        const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
        if (row && typeof row.first_half_present === "boolean" && typeof row.second_half_present === "boolean") return [];
        return [{
          labour_worker_id: deployment.labour_worker_id,
          labour_code: worker?.labour_code || "-",
          worker_name: worker?.worker_name || "-",
          reason: row ? "incomplete_half" : "missing_attendance",
        }];
      });
      if (incompleteWorkers.length) {
        const missingWorkerCount = incompleteWorkers.filter((worker: any) => worker.reason === "missing_attendance").length;
        const incompleteHalfCount = incompleteWorkers.length - missingWorkerCount;
        const parts = [];
        if (missingWorkerCount) parts.push(`${missingWorkerCount} labourers have no attendance`);
        if (incompleteHalfCount) parts.push(`${incompleteHalfCount} labourers have incomplete shift attendance`);
        return NextResponse.json({
          error: `Attendance is incomplete. ${parts.join("; ")}. Complete attendance for every eligible labourer before submitting.`,
          eligible_count: workerIds.length,
          complete_count: workerIds.length - incompleteWorkers.length,
          missing_worker_count: missingWorkerCount,
          incomplete_half_count: incompleteHalfCount,
          affected_workers: incompleteWorkers.slice(0, 10),
        }, { status: 409 });
      }
      if (!["draft", "reopened"].includes(selectedStatus)) return jsonError("Only draft attendance can be submitted for this date.");
      const now = new Date().toISOString();
      const submittedByName = access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
      const { data: snapshot, error: snapshotError } = await access.admin.rpc("create_labour_attendance_submission_snapshot", {
        p_period_id: id,
        p_attendance_date: attendanceDate,
        p_actor: { user_id: access.auth.user.id, name: submittedByName, email: access.auth.user.email || null },
      });
      if (snapshotError) throw snapshotError;
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
        newValues: { attendance_date: attendanceDate, status: "submitted", snapshot },
      });
      return NextResponse.json({ submitted: true, snapshot });
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
