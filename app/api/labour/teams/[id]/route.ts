import { NextResponse } from "next/server";
import {
  applyCompanySiteScope,
  audit,
  jsonError,
  requireLabourPermission,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { isGlobalOrSuperAdmin } from "@/app/api/labour/_shared";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => text(item)).filter((item): item is string => Boolean(item))))
    : [];
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

async function loadTeam(access: any, id: string) {
  let query = access.admin
    .from("labour_work_groups")
    .select("*")
    .eq("id", id)
    .eq("group_type", "engineer_group")
    .maybeSingle();
  query = applyCompanySiteScope(query, access.assignments);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data || null;
}

async function loadCurrentEngineerEmployee(access: any, team: any) {
  if (isGlobalOrSuperAdmin(access)) return { ok: true };
  const { data, error } = await access.admin
    .from("hr_employees")
    .select("id")
    .eq("id", team.engineer_employee_id)
    .eq("user_id", access.auth.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true } : { ok: false };
}

async function loadAvailableWorkers(access: any, team: any, workerIds: string[]) {
  if (!workerIds.length) return { rows: [] };
  const { data: assignments, error } = await access.admin
    .from("labour_site_in_engineer_assignments")
    .select("*, labour_site_ins(id, site_in_time, status), labour_deployments(id, contractor_profile_id, labour_trade_id, trade, status, effective_from, effective_to, labour_trades(id, trade_name))")
    .eq("organization_id", team.organization_id)
    .eq("company_id", team.company_id)
    .eq("site_id", team.site_id)
    .eq("site_in_date", team.work_date)
    .eq("engineer_employee_id", team.engineer_employee_id)
    .eq("status", "active")
    .in("labour_worker_id", workerIds);
  if (error) throw error;
  if ((assignments || []).length !== workerIds.length) return { error: "One or more selected labourers are not assigned to this engineer." };
  const { data: existing, error: memberError } = await access.admin
    .from("labour_work_group_members")
    .select("labour_worker_id")
    .eq("organization_id", team.organization_id)
    .eq("company_id", team.company_id)
    .eq("site_id", team.site_id)
    .eq("work_date", team.work_date)
    .eq("status", "active")
    .in("labour_worker_id", workerIds);
  if (memberError) throw memberError;
  const alreadyAssigned = new Set((existing || []).map((row: any) => row.labour_worker_id));
  const blocked = workerIds.find((workerId) => alreadyAssigned.has(workerId));
  if (blocked) return { error: "One or more selected labourers are already in a temporary team." };
  return { rows: assignments || [] };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const action = text(payload.action) || "rename";
    const permissionAction = action === "cancel" ? "delete" : "edit";
    const access = await requireLabourPermission(request, "labour_engineer_groups", permissionAction);
    if ("response" in access) return access.response;
    const team = await loadTeam(access, id);
    if (!team || team.status === "cancelled") return jsonError("Temporary team was not found.", 404);
    const ownership = await loadCurrentEngineerEmployee(access, team);
    if (!ownership.ok) return jsonError("You can manage only your own temporary teams.", 403);
    const now = new Date().toISOString();

    if (action === "rename") {
      const teamName = text(payload.team_name);
      if (!teamName) return jsonError("Team name is required.");
      const patch = {
        crew_name: teamName,
        group_label: teamName,
        updated_by: access.auth.user.id,
        updated_by_name: actorName(access),
        updated_by_email: access.auth.user.email || null,
        updated_at: now,
      };
      const { error } = await access.admin.from("labour_work_groups").update(patch).eq("id", team.id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_engineer_groups",
        action: "update",
        entityType: "labour_temporary_team",
        recordId: team.id,
        organizationId: team.organization_id,
        companyId: team.company_id,
        siteId: team.site_id,
        description: "Renamed engineer temporary team.",
        oldValues: { crew_name: team.crew_name, group_label: team.group_label },
        newValues: patch,
      });
      return NextResponse.json({ updated: true });
    }

    if (action === "add_members") {
      const workerIds = textArray(payload.labour_worker_ids);
      if (!workerIds.length) return jsonError("Select at least one labourer to add.");
      const available = await loadAvailableWorkers(access, team, workerIds);
      if ("error" in available) return jsonError(available.error || "Selected labourers are not available.", 403);
      const memberPayload = available.rows.map((assignment: any) => {
        const deployment = Array.isArray(assignment.labour_deployments) ? assignment.labour_deployments[0] : assignment.labour_deployments;
        const siteIn = Array.isArray(assignment.labour_site_ins) ? assignment.labour_site_ins[0] : assignment.labour_site_ins;
        const trade = Array.isArray(deployment?.labour_trades) ? deployment.labour_trades[0] : deployment?.labour_trades;
        return {
          work_group_id: team.id,
          organization_id: team.organization_id,
          company_id: team.company_id,
          site_id: team.site_id,
          work_date: team.work_date,
          contractor_profile_id: deployment?.contractor_profile_id || assignment.contractor_profile_id,
          labour_worker_id: assignment.labour_worker_id,
          attendance_id: null,
          deployment_id: assignment.deployment_id,
          site_in_id: assignment.site_in_id,
          site_in_time_snapshot: siteIn?.site_in_time || null,
          category_snapshot: trade?.trade_name || deployment?.trade || null,
          status: "active",
          assigned_by: access.auth.user.id,
          assigned_by_name: actorName(access),
          assigned_by_email: access.auth.user.email || null,
          assigned_at: now,
          updated_by: access.auth.user.id,
          updated_by_name: actorName(access),
          updated_by_email: access.auth.user.email || null,
          updated_at: now,
        };
      });
      const { error } = await access.admin.from("labour_work_group_members").insert(memberPayload);
      if (error) return jsonError(error.code === "23505" ? "One selected labourer is already in a temporary team." : "Could not add team members.", 409);
      await audit(access, request, {
        moduleCode: "labour_engineer_groups",
        action: "update",
        entityType: "labour_temporary_team",
        recordId: team.id,
        organizationId: team.organization_id,
        companyId: team.company_id,
        siteId: team.site_id,
        description: "Added members to engineer temporary team.",
        newValues: { labour_worker_ids: workerIds },
      });
      return NextResponse.json({ added: memberPayload.length });
    }

    if (action === "remove_members") {
      const workerIds = textArray(payload.labour_worker_ids);
      if (!workerIds.length) return jsonError("Select at least one labourer to remove.");
      const patch = {
        status: "cancelled",
        updated_by: access.auth.user.id,
        updated_by_name: actorName(access),
        updated_by_email: access.auth.user.email || null,
        updated_at: now,
      };
      const { error } = await access.admin
        .from("labour_work_group_members")
        .update(patch)
        .eq("work_group_id", team.id)
        .eq("status", "active")
        .in("labour_worker_id", workerIds);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_engineer_groups",
        action: "update",
        entityType: "labour_temporary_team",
        recordId: team.id,
        organizationId: team.organization_id,
        companyId: team.company_id,
        siteId: team.site_id,
        description: "Removed members from engineer temporary team.",
        newValues: { labour_worker_ids: workerIds },
      });
      return NextResponse.json({ removed: workerIds.length });
    }

    if (action === "cancel") {
      const patch = {
        status: "cancelled",
        updated_by: access.auth.user.id,
        updated_by_name: actorName(access),
        updated_by_email: access.auth.user.email || null,
        updated_at: now,
      };
      const { error } = await access.admin.from("labour_work_groups").update(patch).eq("id", team.id);
      if (error) throw error;
      const { error: memberError } = await access.admin
        .from("labour_work_group_members")
        .update(patch)
        .eq("work_group_id", team.id)
        .eq("status", "active");
      if (memberError) throw memberError;
      await audit(access, request, {
        moduleCode: "labour_engineer_groups",
        action: "delete",
        entityType: "labour_temporary_team",
        recordId: team.id,
        organizationId: team.organization_id,
        companyId: team.company_id,
        siteId: team.site_id,
        description: "Cancelled engineer temporary team.",
        oldValues: team,
        newValues: patch,
      });
      return NextResponse.json({ cancelled: true });
    }

    return jsonError("Unsupported team action.");
  } catch (error: any) {
    return jsonError(error.message || "Failed to update temporary team.", 500);
  }
}
