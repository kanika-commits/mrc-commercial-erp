import { NextResponse } from "next/server";
import {
  actorFields,
  applyCompanySiteScope,
  audit,
  jsonError,
  loadResolvedLabourSitePairs,
  loadEligibleDeployments,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  isGlobalOrSuperAdmin,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { dateText } from "@/lib/labour/v2";

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

function contractorName(contractor: any) {
  return contractor?.vendors?.vendor_name || contractor?.contractor_code || "Contractor";
}

function workerFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
}

function tradeFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_trades) ? deployment.labour_trades[0] : deployment.labour_trades;
}

function contractorFromDeployment(deployment: any) {
  return Array.isArray(deployment.labour_contractor_profiles) ? deployment.labour_contractor_profiles[0] : deployment.labour_contractor_profiles;
}

function employeeDepartment(employee: any) {
  const department = Array.isArray(employee?.hr_departments) ? employee.hr_departments[0] : employee?.hr_departments;
  return department?.department_name || "No Department";
}

function employeeLabel(employee: any) {
  if (!employee) return "Engineer";
  return `${employee.employee_name || "Engineer"} — ${employeeDepartment(employee)}`;
}

function moneyLabel(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not Set";
  return `₹${amount.toLocaleString("en-IN")}`;
}

async function loadBaseLookups(access: any) {
  const resolved = await loadResolvedLabourSitePairs(access);
  return { companies: resolved.companies, sites: resolved.sites };
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
  if (!companyId) return { error: "Company is required.", status: 400 };
  if (!siteId) return { error: "Site is required.", status: 400 };
  if (!workDate) return { error: "Date is required.", status: 400 };
  const fallbackOrganizationId = Array.isArray(access.organizationScope) ? access.organizationScope[0] : null;
  const scope = await validateLabourCompanySiteIndependent(access, input.organizationId || fallbackOrganizationId, companyId, siteId);
  if ("error" in scope) return { error: scope.error || "Selected company/site is not available.", status: 403 };
  const system = await resolveSiteAttendanceSystem(access, {
    organizationId: scope.organizationId,
    companyId,
    siteId,
  });
  if (!system.ok) return { error: system.message, status: 403, attendanceSystem: null };
  if (system.attendanceSystem !== "site_in_engineer") {
    return { error: "This site uses Standard Labour Attendance. Temporary Teams are not required.", status: 403, attendanceSystem: system.attendanceSystem };
  }
  return { organizationId: scope.organizationId, companyId, siteId, workDate, attendanceSystem: system.attendanceSystem };
}

async function loadEngineerOptions(access: any, context: { organizationId: string; companyId: string; siteId: string }) {
  const { data, error } = await access.admin
    .from("hr_employees")
    .select("id, employee_name, user_id, department_id, hr_departments(department_name)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("status", "active")
    .order("employee_name");
  if (error) throw error;
  return (data || []).map((employee: any) => ({
    id: employee.id,
    employee_id: employee.id,
    employee_name: employee.employee_name,
    department_name: employeeDepartment(employee),
    user_id: employee.user_id || null,
    label: employeeLabel(employee),
    has_erp_login: Boolean(employee.user_id),
  }));
}

async function resolveEngineerContext(access: any, context: { organizationId: string; companyId: string; siteId: string }, requestedEngineerId?: string | null) {
  const admin = isGlobalOrSuperAdmin(access);
  if (admin) {
    const engineers = await loadEngineerOptions(access, context);
    const engineerId = text(requestedEngineerId);
    const selected = engineerId ? engineers.find((engineer: any) => engineer.id === engineerId) : null;
    return { admin: true, engineers, engineer: selected || null };
  }
  const { data, error } = await access.admin
    .from("hr_employees")
    .select("id, employee_name, user_id, department_id, organization_id, company_id, site_id, status, hr_departments(department_name)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("user_id", access.auth.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { admin: false, engineers: [], engineer: null, error: "Your ERP login is not linked to an active engineer employee for this company/site." };
  return {
    admin: false,
    engineers: [{
      id: data.id,
      employee_id: data.id,
      employee_name: data.employee_name,
      department_name: employeeDepartment(data),
      user_id: data.user_id,
      label: employeeLabel(data),
      has_erp_login: true,
    }],
    engineer: {
      id: data.id,
      employee_id: data.id,
      employee_name: data.employee_name,
      department_name: employeeDepartment(data),
      user_id: data.user_id,
      label: employeeLabel(data),
      has_erp_login: true,
    },
  };
}

async function loadActiveMemberships(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate: string;
  workerIds?: string[];
}) {
  let query = access.admin
    .from("labour_work_group_members")
    .select("*, labour_work_groups!inner(id, group_label, crew_name, engineer_employee_id, group_type, status)")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("work_date", input.workDate)
    .eq("status", "active")
    .eq("labour_work_groups.group_type", "engineer_group")
    .neq("labour_work_groups.status", "cancelled");
  if (input.workerIds?.length) query = query.in("labour_worker_id", input.workerIds);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadTeams(access: any, context: any, engineerEmployeeId?: string | null) {
  let query = access.admin
    .from("labour_work_groups")
    .select("*, hr_employees(id, employee_name, user_id, hr_departments(department_name))")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("work_date", context.workDate)
    .eq("group_type", "engineer_group")
    .neq("status", "cancelled")
    .order("group_number", { ascending: true });
  if (engineerEmployeeId) query = query.eq("engineer_employee_id", engineerEmployeeId);
  const scoped = applyCompanySiteScope(query, access.assignments);
  if (!scoped) return [];
  const { data: teams, error } = await scoped;
  if (error) throw error;
  const teamIds = (teams || []).map((team: any) => team.id);
  if (!teamIds.length) return [];
  const { data: members, error: memberError } = await access.admin
    .from("labour_work_group_members")
    .select("*, labour_workers(id, labour_code, worker_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name)), labour_trades(id, trade_name, trade_code), labour_site_ins(id, site_in_time)")
    .in("work_group_id", teamIds)
    .eq("status", "active")
    .order("assigned_at", { ascending: true });
  if (memberError) throw memberError;
  const membersByTeam = new Map<string, any[]>();
  for (const member of members || []) {
    const worker = Array.isArray(member.labour_workers) ? member.labour_workers[0] : member.labour_workers;
    const contractor = Array.isArray(member.labour_contractor_profiles) ? member.labour_contractor_profiles[0] : member.labour_contractor_profiles;
    const trade = Array.isArray(member.labour_trades) ? member.labour_trades[0] : member.labour_trades;
    const siteIn = Array.isArray(member.labour_site_ins) ? member.labour_site_ins[0] : member.labour_site_ins;
    const normalized = {
      ...member,
      labour_code: worker?.labour_code || null,
      worker_name: worker?.worker_name || null,
      contractor_name: contractorName(contractor),
      category_name: trade?.trade_name || member.category_snapshot || null,
      site_in_time: siteIn?.site_in_time || member.site_in_time_snapshot || null,
    };
    membersByTeam.set(member.work_group_id, [...(membersByTeam.get(member.work_group_id) || []), normalized]);
  }
  return (teams || []).map((team: any) => {
    const engineer = Array.isArray(team.hr_employees) ? team.hr_employees[0] : team.hr_employees;
    return {
      ...team,
      team_name: team.group_label || team.crew_name || `Team ${team.group_number || ""}`.trim(),
      engineer_label: employeeLabel(engineer),
      engineer_has_erp_login: Boolean(engineer?.user_id),
      members: membersByTeam.get(team.id) || [],
    };
  });
}

async function loadEligibleWorkers(access: any, context: any, engineerEmployeeId: string) {
  const assignmentsQuery = access.admin
    .from("labour_site_in_engineer_assignments")
    .select("*, labour_site_ins(id, site_in_time, status)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("site_in_date", context.workDate)
    .eq("engineer_employee_id", engineerEmployeeId)
    .eq("status", "active");
  const { data: assignments, error } = await assignmentsQuery;
  if (error) throw error;
  const workerIds = Array.from(new Set((assignments || []).map((row: any) => row.labour_worker_id).filter(Boolean)));
  const deploymentIds = Array.from(new Set((assignments || []).map((row: any) => row.deployment_id).filter(Boolean)));
  if (!workerIds.length || !deploymentIds.length) return [];
  const [deployments, memberships] = await Promise.all([
    loadEligibleDeployments(access, {
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      attendanceDate: context.workDate,
    }),
    loadActiveMemberships(access, { ...context, workerIds }),
  ]);
  const assignedMemberships = new Map((memberships || []).map((member: any) => [member.labour_worker_id, member]));
  const assignmentByWorker = new Map((assignments || []).map((assignment: any) => [assignment.labour_worker_id, assignment]));
  const deploymentById = new Map((deployments || []).filter((deployment: any) => deploymentIds.includes(deployment.id)).map((deployment: any) => [deployment.id, deployment]));
  return (assignments || [])
    .map((assignment: any) => {
      const deployment: any = deploymentById.get(assignment.deployment_id);
      if (!deployment) return null;
      const worker = workerFromDeployment(deployment);
      const trade = tradeFromDeployment(deployment);
      const contractor = contractorFromDeployment(deployment);
      const siteIn = Array.isArray(assignment.labour_site_ins) ? assignment.labour_site_ins[0] : assignment.labour_site_ins;
      const membership: any = assignedMemberships.get(assignment.labour_worker_id);
      return {
        labour_worker_id: assignment.labour_worker_id,
        deployment_id: assignment.deployment_id,
        site_in_id: assignment.site_in_id,
        assignment_id: assignment.id,
        labour_code: worker?.labour_code || null,
        worker_name: worker?.worker_name || null,
        contractor_profile_id: deployment.contractor_profile_id,
        contractor_name: contractorName(contractor),
        labour_trade_id: deployment.labour_trade_id,
        category_name: trade?.trade_name || deployment.trade || null,
        daily_rate: deployment.wage_rate,
        daily_rate_label: moneyLabel(deployment.wage_rate),
        site_in_time: siteIn?.site_in_time || null,
        already_teamed: Boolean(membership),
        work_group_id: membership?.work_group_id || null,
        selectable: !membership,
      };
    })
    .filter(Boolean);
}

async function loadEligibleMap(access: any, context: any, engineerEmployeeId: string, workerIds: string[]) {
  const eligible = await loadEligibleWorkers(access, context, engineerEmployeeId);
  const available = eligible.filter((row: any) => !row.already_teamed);
  const map = new Map(available.map((row: any) => [row.labour_worker_id, row]));
  const missing = workerIds.find((workerId) => !map.has(workerId));
  if (missing) return { error: "One or more selected labourers are not available for this engineer's temporary teams." };
  return { eligibleByWorker: map };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_engineer_groups", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const lookups = await loadBaseLookups(access);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const workDate = dateText(searchParams.get("work_date"));
    if (!companyId || !siteId || !workDate) {
      return NextResponse.json({ ...lookups, teams: [], unassigned_labour: [], engineers: [], current_engineer: null });
    }
    const context = await resolveContext(access, { companyId, siteId, workDate, organizationId: searchParams.get("organization_id") });
    if ("error" in context) return jsonError(context.error || "Temporary Teams are not available.", context.status || 403);
    const engineerContext = await resolveEngineerContext(access, context, searchParams.get("engineer_employee_id"));
    if (engineerContext.error) return jsonError(engineerContext.error, 403);
    const selectedEngineer = engineerContext.engineer;
    if (!selectedEngineer) {
      return NextResponse.json({ ...lookups, engineers: engineerContext.engineers, current_engineer: null, teams: [], unassigned_labour: [], admin_mode: engineerContext.admin });
    }
    const [teams, labour] = await Promise.all([
      loadTeams(access, context, selectedEngineer.id),
      loadEligibleWorkers(access, context, selectedEngineer.id),
    ]);
    return NextResponse.json({
      ...lookups,
      admin_mode: engineerContext.admin,
      engineers: engineerContext.engineers,
      current_engineer: selectedEngineer,
      attendance_system: context.attendanceSystem,
      teams,
      unassigned_labour: labour.filter((row: any) => !row.already_teamed),
      assigned_labour: labour,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load temporary teams.", 500);
  }
}

export async function POST(request: Request) {
  let createdTeamId: string | null = null;
  let access: any = null;
  try {
    access = await requireLabourPermission(request, "labour_engineer_groups", "create");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const context = await resolveContext(access, {
      organizationId: text(payload.organization_id),
      companyId: text(payload.company_id),
      siteId: text(payload.site_id),
      workDate: text(payload.work_date),
    });
    if ("error" in context) return jsonError(context.error || "Temporary Teams are not available.", context.status || 403);
    const engineerContext = await resolveEngineerContext(access, context, text(payload.engineer_employee_id));
    if (engineerContext.error) return jsonError(engineerContext.error, 403);
    if (engineerContext.admin && !engineerContext.engineer) return jsonError("Engineer is required.");
    const engineer = engineerContext.engineer;
    const workerIds = textArray(payload.labour_worker_ids);
    if (!workerIds.length) return jsonError("Select at least one labourer for the temporary team.");
    const eligible = await loadEligibleMap(access, context, engineer.id, workerIds);
    if ("error" in eligible) return jsonError(eligible.error || "Selected labourers are not available.", 403);
    const eligibleByWorker = eligible.eligibleByWorker;
    const { data: existingTeams, error: countError } = await access.admin
      .from("labour_work_groups")
      .select("group_number")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("work_date", context.workDate)
      .eq("engineer_employee_id", engineer.id)
      .eq("group_type", "engineer_group")
      .neq("status", "cancelled");
    if (countError) throw countError;
    const nextNumber = Math.max(0, ...(existingTeams || []).map((team: any) => Number(team.group_number) || 0)) + 1;
    const teamLabel = text(payload.team_name) || `Team ${nextNumber}`;
    const now = new Date().toISOString();
    const teamPayload = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      work_date: context.workDate,
      contractor_profile_id: null,
      commercial_work_order_id: null,
      manpower_work_order_id: null,
      commercial_model: "contract_basis",
      crew_code: null,
      crew_name: teamLabel,
      group_label: teamLabel,
      group_number: nextNumber,
      group_type: "engineer_group",
      engineer_employee_id: engineer.id,
      engineer_user_id: engineer.user_id || null,
      supervisor_user_id: engineer.user_id || null,
      status: "draft",
      updated_at: now,
      ...actorFields(access.auth, "created"),
      ...actorFields(access.auth, "updated"),
    };
    const { data: team, error: teamError } = await access.admin.from("labour_work_groups").insert(teamPayload).select("id").single();
    if (teamError) throw teamError;
    createdTeamId = team.id;
    const memberPayload = workerIds.map((workerId) => {
      const row: any = eligibleByWorker.get(workerId);
      return {
        work_group_id: team.id,
        organization_id: context.organizationId,
        company_id: context.companyId,
        site_id: context.siteId,
        work_date: context.workDate,
        contractor_profile_id: row.contractor_profile_id,
        labour_worker_id: workerId,
        attendance_id: null,
        deployment_id: row.deployment_id,
        site_in_id: row.site_in_id,
        site_in_time_snapshot: row.site_in_time,
        joined_from: null,
        joined_to: null,
        role_snapshot: null,
        category_snapshot: row.category_name,
        status: "active",
        assigned_by: access.auth.user.id,
        assigned_by_name: actorName(access),
        assigned_by_email: access.auth.user.email || null,
        assigned_at: now,
        updated_by: access.auth.user.id,
        updated_by_name: actorName(access),
        updated_by_email: access.auth.user.email || null,
        updated_at: now,
        ...actorFields(access.auth, "created"),
      };
    });
    const { error: memberError } = await access.admin.from("labour_work_group_members").insert(memberPayload);
    if (memberError) {
      await access.admin.from("labour_work_groups").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", team.id);
      return jsonError(memberError.code === "23505" ? "One selected labourer is already in another temporary team." : "Could not add members to the temporary team.", 409);
    }
    await audit(access, request, {
      moduleCode: "labour_engineer_groups",
      action: "create",
      entityType: "labour_temporary_team",
      recordId: team.id,
      organizationId: context.organizationId,
      companyId: context.companyId,
      siteId: context.siteId,
      description: "Created engineer temporary team.",
      newValues: { ...teamPayload, member_count: memberPayload.length },
    });
    return NextResponse.json({ team_id: team.id, group_number: nextNumber, team_name: teamLabel, members: memberPayload.length });
  } catch (error: any) {
    if (createdTeamId && access?.admin) {
      await access.admin.from("labour_work_groups").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", createdTeamId);
    }
    return jsonError(error.message || "Failed to create temporary team.", 500);
  }
}
