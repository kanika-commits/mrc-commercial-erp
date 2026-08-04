import { NextResponse } from "next/server";
import {
  actorFields,
  applyCompanySiteScope,
  audit,
  jsonError,
  loadLabourEditLockBlocker,
  loadResolvedLabourSitePairs,
  requireLabourPermission,
  validateLabourCompanySiteIndependent,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { dateText, numberOrNull } from "@/lib/labour/v2";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const WORK_TYPES = ["productive", "non_productive"] as const;

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isInteger(next) ? next : null;
}

function contractorName(contractor: any) {
  return contractor?.vendors?.vendor_name || contractor?.contractor_code || "Contractor";
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

function hasServerPermission(access: any, moduleCode: string, actionCode: string) {
  return (access.auth.permissions || []).some((permission: any) =>
    permission.allowed === true &&
    ((permission.module_code === "*" && permission.action_code === "*") ||
      (permission.module_code === moduleCode && permission.action_code === actionCode)),
  );
}

function canAssignEngineer(access: any) {
  return hasServerPermission(access, "labour_work_logs", "assign_engineer");
}

async function loadBaseLookups(access: any) {
  const resolved = await loadResolvedLabourSitePairs(access);
  return { companies: resolved.companies, sites: resolved.sites };
}

async function loadSiteInContractors(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
}) {
  let siteInQuery = access.admin
    .from("labour_site_ins")
    .select("contractor_profile_id")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("site_in_date", input.workDate)
    .eq("status", "active");
  siteInQuery = applyCompanySiteScope(siteInQuery, access.assignments);
  if (!siteInQuery) return [];
  const { data: siteIns, error: siteInError } = await siteInQuery;
  if (siteInError) throw siteInError;
  const counts = new Map<string, number>();
  for (const row of siteIns || []) {
    if (!row.contractor_profile_id) continue;
    counts.set(row.contractor_profile_id, (counts.get(row.contractor_profile_id) || 0) + 1);
  }
  const contractorIds = Array.from(counts.keys());
  if (!contractorIds.length) return [];
  const query = applyOrganizationScope(
    access.admin
      .from("labour_contractor_profiles")
      .select("id, organization_id, vendor_id, contractor_code, contractor_status, vendors(vendor_name)")
      .in("id", contractorIds)
      .eq("contractor_status", "active")
      .order("contractor_code"),
    access.organizationScope,
  );
  const { data, error } = query ? await query : { data: [], error: null };
  if (error) throw error;
  return (data || [])
    .map((contractor: any) => ({ ...contractor, site_in_count: counts.get(contractor.id) || 0 }))
    .sort((a: any, b: any) => contractorName(a).localeCompare(contractorName(b)));
}

async function loadWorkLogs(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
  contractorIds?: string[] | null;
}) {
  let query = access.admin
    .from("labour_daily_work_logs")
    .select("*, labour_contractor_profiles(id, contractor_code, vendors(vendor_name)), labour_photo_evidence(id, photo_type, is_active, original_file_name)")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("work_date", input.workDate)
    .order("created_at", { ascending: true });
  if (input.contractorIds) {
    if (!input.contractorIds.length) return [];
    query = query.in("contractor_profile_id", input.contractorIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadEngineerAssignments(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
  contractorIds: string[];
}) {
  if (!input.contractorIds.length) return [];
  const { data, error } = await access.admin
    .from("labour_daily_work_engineer_assignments")
    .select("*, profiles(id, email, full_name, status)")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("work_date", input.workDate)
    .eq("status", "active")
    .in("contractor_profile_id", input.contractorIds);
  if (error) throw error;
  return data || [];
}

function displayUser(profile: any) {
  return profile?.full_name || profile?.email || "User";
}

async function loadEngineerOptions(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  const [profilesResult, accessRowsResult, userRolesResult, rolesResult, rolePermissionsResult, userPermissionsResult] = await Promise.all([
    access.admin.from("profiles").select("id, email, full_name, status").eq("status", "active"),
    access.admin.from("user_access_assignments").select("user_id, organization_id, company_id, site_id"),
    access.admin.from("user_roles").select("user_id, role_id"),
    access.admin.from("roles").select("id, role_code, status"),
    access.admin.from("role_permissions").select("role_id, module_code, action_code, allowed"),
    access.admin.from("user_permissions").select("user_id, module_code, action_code, allowed"),
  ]);
  for (const result of [profilesResult, accessRowsResult, userRolesResult, rolesResult, rolePermissionsResult, userPermissionsResult]) {
    if (result.error) throw result.error;
  }

  const roleById = new Map<string, any>((rolesResult.data || []).map((role: any) => [role.id, role]));
  const rolesByUser = new Map<string, any[]>();
  for (const row of userRolesResult.data || []) {
    const role = roleById.get(row.role_id);
    if (!role || ["inactive", "deleted", "disabled"].includes(String(role.status || "").toLowerCase())) continue;
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), role]);
  }

  const rolePermsByRole = new Map<string, any[]>();
  for (const permission of rolePermissionsResult.data || []) {
    rolePermsByRole.set(permission.role_id, [...(rolePermsByRole.get(permission.role_id) || []), permission]);
  }
  const userPermsByUser = new Map<string, any[]>();
  for (const permission of userPermissionsResult.data || []) {
    userPermsByUser.set(permission.user_id, [...(userPermsByUser.get(permission.user_id) || []), permission]);
  }
  const assignmentsByUser = new Map<string, any[]>();
  for (const row of accessRowsResult.data || []) {
    assignmentsByUser.set(row.user_id, [...(assignmentsByUser.get(row.user_id) || []), row]);
  }

  function hasPermission(userId: string, moduleCode: string, actionCode: string) {
    const roles = rolesByUser.get(userId) || [];
    const permissions = [
      ...roles.flatMap((role) => rolePermsByRole.get(role.id) || []),
      ...(userPermsByUser.get(userId) || []),
    ];
    const latest = new Map<string, any>();
    for (const permission of permissions) latest.set(`${permission.module_code}:${permission.action_code}`, permission);
    return Array.from(latest.values()).some((permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode && permission.action_code === actionCode)),
    );
  }

  function isInScope(userId: string) {
    const roles = rolesByUser.get(userId) || [];
    if (roles.some((role) => role.role_code === "platform_owner" || role.role_code === "super_admin")) return true;
    const assignments = assignmentsByUser.get(userId) || [];
    return assignments.some((row) =>
      row.organization_id === input.organizationId &&
      (!row.company_id || row.company_id === input.companyId) &&
      (!row.site_id || row.site_id === input.siteId),
    );
  }

  return (profilesResult.data || [])
    .filter((profile: any) =>
      isInScope(profile.id) &&
      hasPermission(profile.id, "labour_work_logs", "view") &&
      hasPermission(profile.id, "labour_work_logs", "add"),
    )
    .map((profile: any) => ({ id: profile.id, email: profile.email, full_name: profile.full_name, label: displayUser(profile) }))
    .sort((a: any, b: any) => a.label.localeCompare(b.label));
}

async function loadVisibleContractorIds(access: any, context: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
}, contractorIds: string[]) {
  if (canAssignEngineer(access)) return contractorIds;
  const assignments = await loadEngineerAssignments(access, { ...context, contractorIds });
  return assignments
    .filter((assignment: any) => assignment.engineer_user_id === access.auth.user.id)
    .map((assignment: any) => assignment.contractor_profile_id);
}

async function validateEngineerDailyWorkAccess(access: any, context: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
}, contractorProfileId: string | null) {
  if (!contractorProfileId || canAssignEngineer(access)) return null;
  const assignments = await loadEngineerAssignments(access, { ...context, contractorIds: [contractorProfileId] });
  const assigned = assignments.some((assignment: any) => assignment.engineer_user_id === access.auth.user.id);
  return assigned ? null : "You are not assigned to this contractor for Daily Work.";
}

async function validateEngineerCandidate(access: any, context: {
  organizationId: string;
  companyId: string;
  siteId: string;
}, engineerUserId: string) {
  const engineers = await loadEngineerOptions(access, context);
  return engineers.find((engineer: any) => engineer.id === engineerUserId) || null;
}

async function resolveContext(access: any, input: {
  organizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
  workDate?: string | null;
}) {
  const companyId = text(input.companyId);
  const siteId = text(input.siteId);
  const workDate = dateText(input.workDate);
  if (!companyId || !siteId || !workDate) return { error: "Company, site and work date are required." };
  const scopeCheck = await validateLabourCompanySiteIndependent(access, input.organizationId, companyId, siteId);
  if ("error" in scopeCheck) return { error: scopeCheck.error || "Selected company/site is not available.", status: 403 };
  return { organizationId: scopeCheck.organizationId, companyId, siteId, workDate };
}

async function validateContractorInSiteIn(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
  contractorProfileId: string | null;
}) {
  if (!input.contractorProfileId) return { error: "Contractor is required." };
  const contractors = await loadSiteInContractors(access, input);
  const contractor = contractors.find((item: any) => item.id === input.contractorProfileId);
  if (!contractor) return { error: "Selected contractor has no Site-In labour for this Site/date." };
  return { contractor, siteInCount: Number(contractor.site_in_count || 0) };
}

function validateDraftRow(payload: any, siteInCount: number) {
  const contractorProfileId = text(payload.contractor_profile_id);
  const workType = text(payload.work_type);
  const description = text(payload.work_description || payload.activity);
  const labourCount = integerOrNull(payload.labour_count);
  const quantity = numberOrNull(payload.quantity);
  const unit = text(payload.unit);
  if (!contractorProfileId) return { error: "Contractor is required." };
  if (labourCount === null || labourCount <= 0) return { error: "Labour Count is required and must be a whole number." };
  if (labourCount > siteInCount) return { error: `Labour Count cannot exceed Site-In Labour: ${siteInCount}.` };
  if (!workType || !WORK_TYPES.includes(workType as any)) return { error: "Work Type is required." };
  if (!description) return { error: "Work Description is required." };
  if (workType === "productive") {
    if (quantity === null || quantity <= 0) return { error: "Quantity is required for Productive work." };
    if (!unit) return { error: "Unit is required for Productive work." };
  }
  if (payload.quantity !== undefined && payload.quantity !== "" && (quantity === null || quantity < 0)) {
    return { error: "Quantity must be a valid non-negative number." };
  }
  return { contractorProfileId, workType, description, labourCount, quantity, unit };
}

function activePhotoCount(log: any) {
  return (log.labour_photo_evidence || []).filter((photo: any) => photo.is_active !== false).length;
}

function activePhotoIds(log: any) {
  return (log.labour_photo_evidence || [])
    .filter((photo: any) => photo.is_active !== false)
    .map((photo: any) => photo.id)
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_logs", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const requestedOrganizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const workDate = dateText(searchParams.get("work_date"));
    const lookups = await loadBaseLookups(access);
    if (!companyId || !siteId || !workDate) {
      return NextResponse.json({ ...lookups, contractors: [], work_logs: [], message: null });
    }
    const context = await resolveContext(access, { organizationId: requestedOrganizationId, companyId, siteId, workDate });
    if ("error" in context) return jsonError(context.error || "Selected context is not available.", context.status || 400);
    const siteInContractors = await loadSiteInContractors(access, context);
    const contractorIds = siteInContractors.map((contractor: any) => contractor.id).filter(Boolean);
    const [assignments, engineers] = await Promise.all([
      loadEngineerAssignments(access, { ...context, contractorIds }),
      canAssignEngineer(access) ? loadEngineerOptions(access, context) : Promise.resolve([]),
    ]);
    const visibleContractorIds = await loadVisibleContractorIds(access, context, contractorIds);
    const visibleContractorIdSet = new Set(visibleContractorIds);
    const assignmentsByContractor = new Map(assignments.map((assignment: any) => [assignment.contractor_profile_id, assignment]));
    const contractors = siteInContractors
      .filter((contractor: any) => visibleContractorIdSet.has(contractor.id))
      .map((contractor: any) => {
        const assignment: any = assignmentsByContractor.get(contractor.id);
        const profile = assignment?.profiles;
        return {
          ...contractor,
          assigned_engineer_user_id: assignment?.engineer_user_id || null,
          assigned_engineer_name: displayUser(profile),
          assigned_engineer_email: profile?.email || null,
        };
      });
    const workLogs = await loadWorkLogs(access, { ...context, contractorIds: visibleContractorIds });
    return NextResponse.json({
      ...lookups,
      can_assign_engineer: canAssignEngineer(access),
      engineers,
      assignments,
      contractors,
      work_logs: workLogs.map((log: any) => ({
        ...log,
        work_description: log.activity,
        photo_count: activePhotoCount(log),
        photo_ids: activePhotoIds(log),
      })),
      message: contractors.length ? null : "No contractors have Site-In labour for the selected Site/date.",
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Daily Work.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_logs", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const context = await resolveContext(access, {
      organizationId: requestedOrganizationId,
      companyId: payload.company_id,
      siteId: payload.site_id,
      workDate: payload.work_date,
    });
    if ("error" in context) return jsonError(context.error || "Selected Daily Work context is not available.", context.status || 400);
    const contractorCheck = await validateContractorInSiteIn(access, {
      ...context,
      contractorProfileId: text(payload.contractor_profile_id),
    });
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const engineerBlocker = await validateEngineerDailyWorkAccess(access, context, text(payload.contractor_profile_id));
    if (engineerBlocker) return jsonError(engineerBlocker, 403);
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      contractorProfileId: text(payload.contractor_profile_id),
      attendanceDate: context.workDate,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const row = validateDraftRow(payload, contractorCheck.siteInCount);
    if ("error" in row) return jsonError(row.error || "Daily Work row is invalid.");
    const insertPayload = {
      work_group_id: null,
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      work_date: context.workDate,
      contractor_profile_id: row.contractorProfileId,
      commercial_work_order_id: null,
      manpower_work_order_id: null,
      commercial_model: "contract_basis",
      work_type: row.workType,
      work_period: "regular",
      labour_count: row.labourCount,
      activity: row.description,
      location_zone: null,
      start_time: null,
      end_time: null,
      unit: row.workType === "productive" ? row.unit : row.unit,
      quantity: row.quantity,
      remarks: text(payload.remarks),
      non_productive_reason: row.workType === "non_productive" ? row.description : null,
      status: "draft",
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_daily_work_logs").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_work_logs",
      action: "create",
      entityType: "labour_daily_work_log",
      recordId: data.id,
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      description: "Created Daily Work draft row.",
      newValues: insertPayload,
    });
    return NextResponse.json({ work_log_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save Daily Work.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_logs", "edit");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const id = text(payload.id);
    if (!id) return jsonError("Daily Work row is required.");
    const { data: current, error: loadError } = await access.admin.from("labour_daily_work_logs").select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!current) return jsonError("Daily Work row not found.", 404);
    if (current.status !== "draft") return jsonError("Only Draft Daily Work rows can be edited.", 403);
    if (access.organizationScope !== null && !access.organizationScope.includes(current.organization_id)) return jsonError("Daily Work row not found.", 404);
    if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(current.company_id)) return jsonError("Daily Work row not found.", 404);
    if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(current.site_id)) return jsonError("Daily Work row not found.", 404);
    const context = {
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      workDate: current.work_date,
    };
    const contractorCheck = await validateContractorInSiteIn(access, {
      ...context,
      contractorProfileId: text(payload.contractor_profile_id),
    });
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const engineerBlocker = await validateEngineerDailyWorkAccess(access, context, text(payload.contractor_profile_id));
    if (engineerBlocker) return jsonError(engineerBlocker, 403);
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      ...context,
      contractorProfileId: text(payload.contractor_profile_id),
      attendanceDate: current.work_date,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const row = validateDraftRow(payload, contractorCheck.siteInCount);
    if ("error" in row) return jsonError(row.error || "Daily Work row is invalid.");
    const patch = {
      contractor_profile_id: row.contractorProfileId,
      work_type: row.workType,
      labour_count: row.labourCount,
      activity: row.description,
      unit: row.workType === "productive" ? row.unit : row.unit,
      quantity: row.quantity,
      remarks: text(payload.remarks),
      non_productive_reason: row.workType === "non_productive" ? row.description : null,
      ...actorFields(access.auth, "updated"),
      updated_at: new Date().toISOString(),
    };
    const { error } = await access.admin.from("labour_daily_work_logs").update(patch).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_work_logs",
      action: "update",
      entityType: "labour_daily_work_log",
      recordId: id,
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      description: "Updated Daily Work draft row.",
      oldValues: current,
      newValues: patch,
    });
    return NextResponse.json({ updated: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update Daily Work.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_logs", "assign_engineer");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const context = await resolveContext(access, {
      organizationId: requestedOrganizationId,
      companyId: payload.company_id,
      siteId: payload.site_id,
      workDate: payload.work_date,
    });
    if ("error" in context) return jsonError(context.error || "Selected Daily Work context is not available.", context.status || 400);
    const contractorProfileId = text(payload.contractor_profile_id);
    const engineerUserId = text(payload.engineer_user_id);
    if (!engineerUserId) return jsonError("Engineer is required.");
    const contractorCheck = await validateContractorInSiteIn(access, { ...context, contractorProfileId });
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const engineer = await validateEngineerCandidate(access, context, engineerUserId);
    if (!engineer) return jsonError("Selected engineer is not available for this company/site or lacks Daily Work permissions.", 403);
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      ...context,
      contractorProfileId,
      attendanceDate: context.workDate,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);

    const { data: existing, error: existingError } = await access.admin
      .from("labour_daily_work_engineer_assignments")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("work_date", context.workDate)
      .eq("contractor_profile_id", contractorProfileId)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw existingError;

    const actor = {
      by: access.auth.user.id,
      by_name: actorName(access),
      by_email: access.auth.user.email || null,
    };
    let assignmentId = existing?.id;
    if (existing) {
      const patch = {
        engineer_user_id: engineerUserId,
        updated_by: actor.by,
        updated_by_name: actor.by_name,
        updated_by_email: actor.by_email,
        updated_at: new Date().toISOString(),
      };
      const { error } = await access.admin.from("labour_daily_work_engineer_assignments").update(patch).eq("id", existing.id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_work_logs",
        action: "update",
        entityType: "labour_daily_work_engineer_assignment",
        recordId: existing.id,
        organizationId: context.organizationId,
        companyId: context.companyId,
        siteId: context.siteId,
        description: "Changed Daily Work engineer assignment.",
        oldValues: existing,
        newValues: patch,
      });
    } else {
      const insertPayload = {
        organization_id: context.organizationId,
        company_id: context.companyId,
        site_id: context.siteId,
        work_date: context.workDate,
        contractor_profile_id: contractorProfileId,
        engineer_user_id: engineerUserId,
        status: "active",
        assigned_by: actor.by,
        assigned_by_name: actor.by_name,
        assigned_by_email: actor.by_email,
        assigned_at: new Date().toISOString(),
      };
      const { data, error } = await access.admin.from("labour_daily_work_engineer_assignments").insert(insertPayload).select("id").single();
      if (error) throw error;
      assignmentId = data.id;
      await audit(access, request, {
        moduleCode: "labour_work_logs",
        action: "create",
        entityType: "labour_daily_work_engineer_assignment",
        recordId: data.id,
        organizationId: context.organizationId,
        companyId: context.companyId,
        siteId: context.siteId,
        description: "Assigned engineer to Daily Work contractor package.",
        newValues: insertPayload,
      });
    }
    return NextResponse.json({ assignment_id: assignmentId, engineer });
  } catch (error: any) {
    return jsonError(error.message || "Failed to assign Daily Work engineer.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_work_logs", "delete");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const id = text(searchParams.get("id"));
    if (!id) return jsonError("Daily Work row is required.");
    const { data: current, error: loadError } = await access.admin.from("labour_daily_work_logs").select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!current) return jsonError("Daily Work row not found.", 404);
    if (current.status !== "draft") return jsonError("Only Draft Daily Work rows can be removed.", 403);
    if (access.organizationScope !== null && !access.organizationScope.includes(current.organization_id)) return jsonError("Daily Work row not found.", 404);
    if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(current.company_id)) return jsonError("Daily Work row not found.", 404);
    if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(current.site_id)) return jsonError("Daily Work row not found.", 404);
    const engineerBlocker = await validateEngineerDailyWorkAccess(access, {
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      workDate: current.work_date,
    }, current.contractor_profile_id);
    if (engineerBlocker) return jsonError(engineerBlocker, 403);
    const lockBlocker = await loadLabourEditLockBlocker(access, {
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      contractorProfileId: current.contractor_profile_id,
      attendanceDate: current.work_date,
    });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const { error } = await access.admin.from("labour_daily_work_logs").delete().eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_work_logs",
      action: "delete",
      entityType: "labour_daily_work_log",
      recordId: id,
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      description: "Removed Daily Work draft row.",
      oldValues: current,
    });
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to remove Daily Work row.", 500);
  }
}
