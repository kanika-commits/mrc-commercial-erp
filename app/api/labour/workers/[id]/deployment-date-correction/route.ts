import { NextResponse } from "next/server";
import { audit, jsonError, loadScopedWorker, requireLabourPermission } from "@/app/api/labour/_shared";

function text(value: unknown) {
  const next = String(value || "").trim();
  return next || null;
}

function isGlobalRole(roleCodes: string[]) {
  return roleCodes.includes("platform_owner") || roleCodes.includes("super_admin");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "edit");
    if ("response" in access) return access.response;
    if (!isGlobalRole(access.auth.roleCodes)) return jsonError("Only Platform Owner or Super Admin may correct deployment dates.", 403);

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const deploymentId = text(payload.deployment_id);
    const correctedDate = text(payload.corrected_effective_from);
    const reason = text(payload.reason);
    if (!deploymentId || !correctedDate) return jsonError("Deployment and corrected effective date are required.");
    if (!reason || reason.length < 10) return jsonError("A correction reason of at least 10 characters is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correctedDate)) return jsonError("Corrected effective date must be a valid calendar date.");

    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const { data: deployment, error: deploymentError } = await access.admin
      .from("labour_deployments")
      .select("id, organization_id, labour_worker_id, effective_from, effective_to, status, company_id, site_id")
      .eq("id", deploymentId)
      .eq("labour_worker_id", id)
      .eq("organization_id", worker.organization_id)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment) return jsonError("Deployment not found.", 404);
    if (deployment.effective_from === correctedDate) return jsonError("Corrected effective date must differ from the current date.");
    if (deployment.effective_to && correctedDate > deployment.effective_to) return jsonError("Corrected effective date cannot be after the deployment end date.");

    const [{ data: previous }, { data: next }, { count: attendanceCount, error: attendanceError }, { count: snapshotCount, error: snapshotError }] = await Promise.all([
      access.admin.from("labour_deployments").select("id, effective_from").eq("labour_worker_id", id).lt("effective_from", correctedDate).neq("id", deploymentId).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
      access.admin.from("labour_deployments").select("id, effective_from").eq("labour_worker_id", id).gt("effective_from", correctedDate).neq("id", deploymentId).order("effective_from", { ascending: true }).limit(1).maybeSingle(),
      access.admin.from("labour_attendance").select("id", { count: "exact", head: true }).eq("deployment_id", deploymentId),
      access.admin.from("labour_attendance_submission_version_rows").select("id", { count: "exact", head: true }).eq("deployment_id", deploymentId),
    ]);
    if (attendanceError) throw attendanceError;
    if (snapshotError) throw snapshotError;
    if (previous && correctedDate <= previous.effective_from) return jsonError("Corrected date would violate the previous deployment boundary.");
    if (next && correctedDate >= next.effective_from) return jsonError("Corrected date would violate the next deployment boundary.");
    if ((attendanceCount || 0) > 0 || (snapshotCount || 0) > 0) return jsonError("This deployment is referenced by attendance history and cannot be date-corrected safely.", 409);

    const actor = access.auth.user;
    const actorName = actor.user_metadata?.full_name || actor.user_metadata?.name || actor.email || "Unknown User";
    const { data: updated, error: updateError } = await access.admin
      .from("labour_deployments")
      .update({ effective_from: correctedDate, updated_at: new Date().toISOString(), updated_by: actor.id, updated_by_name: actorName, updated_by_email: actor.email || null })
      .eq("id", deploymentId)
      .eq("labour_worker_id", id)
      .select("id, effective_from")
      .single();
    if (updateError) throw updateError;

    await audit(access, request, {
      moduleCode: "labour_deployments",
      action: "update",
      entityType: "labour_deployment",
      recordId: deploymentId,
      parentEntityType: "labour_worker",
      parentRecordId: id,
      organizationId: worker.organization_id,
      companyId: deployment.company_id,
      siteId: deployment.site_id,
      description: "Corrected labour deployment effective date.",
      oldValues: { effective_from: deployment.effective_from, reason },
      newValues: { effective_from: correctedDate, reason },
    } as any);
    return NextResponse.json({ deployment: updated });
  } catch (error: any) {
    return jsonError(error.message || "Failed to correct deployment date.", 500);
  }
}
