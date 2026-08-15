import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  getActiveLabourOrganizationConfiguration,
  getActiveMusterConfiguration,
  getActiveSiteAttendanceSystemPolicy,
  hasLabourPermission,
  jsonError,
  requireLabourPermission,
  validateLabourCompanySiteIndependent,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { loadActiveSiteHrUserIds } from "@/lib/serverSiteHr";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function wholeHours(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const hours = Number(raw);
  return Number.isSafeInteger(hours) && hours >= 0 ? hours : null;
}

function attendanceSystemValue(value: unknown) {
  const next = text(value);
  if (!next) return null;
  return next === "standard" || next === "site_in_engineer" ? next : "__invalid__";
}

function displayUser(profile: any) {
  return profile?.full_name || profile?.email || "User";
}

function displayEmployee(employee: any, profile?: any) {
  const parts = [
    employee.employee_name,
    employee.employee_code,
    [employee.hr_departments?.department_name, employee.hr_designations?.designation_name].filter(Boolean).join(" / "),
    employee.sites?.site_name || "Head Office",
  ].filter(Boolean);
  const suffix = profile?.status === "active" ? "" : profile ? " — Inactive ERP Login" : " — No ERP Login";
  return `${parts.join(" — ")}${suffix}`;
}

function lowerEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function profileDisplay(profile: any) {
  return profile?.full_name || profile?.email || "ERP User";
}

function isWildcardRole(roles: any[]) {
  return roles.some((role) => ["platform_owner", "super_admin"].includes(role.role_code));
}

async function loadConfigurationLookups(access: any) {
  let companyQuery = applyOrganizationScope(
    access.admin.from("companies").select("id, organization_id, company_name, company_code, status").eq("status", "active").order("company_name"),
    access.organizationScope,
  );
  let siteQuery = applyOrganizationScope(
    access.admin.from("sites").select("id, organization_id, company_id, site_name, site_code, status").eq("status", "active").order("site_name"),
    access.organizationScope,
  );
  if (companyQuery && access.assignments.companyIds?.length) {
    companyQuery = companyQuery.in("id", access.assignments.companyIds);
  } else if (companyQuery && access.assignments.companyIds && !access.assignments.companyIds.length) {
    companyQuery = null;
  }
  if (siteQuery && access.assignments.siteIds?.length) {
    siteQuery = siteQuery.in("id", access.assignments.siteIds);
  } else if (siteQuery && access.assignments.siteIds && !access.assignments.siteIds.length && access.assignments.companyIds && !access.assignments.companyIds.length) {
    siteQuery = null;
  }
  const [companies, sites] = await Promise.all([
    companyQuery ? companyQuery : Promise.resolve({ data: [], error: null }),
    siteQuery ? siteQuery : Promise.resolve({ data: [], error: null }),
  ]);
  if (companies.error) throw companies.error;
  if (sites.error) throw sites.error;
  return { companies: companies.data || [], sites: sites.data || [] };
}

async function loadAttendancePolicyRows(access: any) {
  let query = applyOrganizationScope(
    access.admin
      .from("labour_site_configurations")
      .select("id, organization_id, company_id, site_id, attendance_system, attendance_lock_hours, status, updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
    access.organizationScope,
  );
  if (!query) return { rows: [], conflicts: [] };
  if (access.assignments.siteIds?.length) {
    query = query.in("site_id", access.assignments.siteIds);
  } else if (access.assignments.companyIds?.length) {
    query = query.in("company_id", access.assignments.companyIds);
  } else if (access.assignments.siteIds && access.assignments.companyIds && !access.assignments.siteIds.length && !access.assignments.companyIds.length) {
    return { rows: [], conflicts: [] };
  }
  const { data: configurationRows, error } = await query;
  if (error) throw error;
  const rows = configurationRows || [];
  const companyIds = Array.from(new Set(rows.map((row: any) => row.company_id).filter(Boolean)));
  const siteIds = Array.from(new Set(rows.map((row: any) => row.site_id).filter(Boolean)));
  const organizationIds = Array.from(new Set(rows.map((row: any) => row.organization_id).filter(Boolean)));

  const [companyResult, siteResult, sitePolicyResult] = await Promise.all([
    companyIds.length
      ? access.admin.from("companies").select("id, company_name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? access.admin.from("sites").select("id, site_name").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length && organizationIds.length
      ? access.admin
          .from("labour_site_attendance_policies")
          .select("id, organization_id, company_id, site_id, attendance_system, backdated_window_days, status, effective_from, effective_to")
          .in("organization_id", organizationIds)
          .in("site_id", siteIds)
          .is("company_id", null)
          .eq("status", "active")
          .is("effective_to", null)
          .order("effective_from", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [companyResult, siteResult, sitePolicyResult]) {
    if (result.error) throw result.error;
  }
  const companyNames = new Map((companyResult.data || []).map((company: any) => [company.id, company.company_name]));
  const siteNames = new Map((siteResult.data || []).map((site: any) => [site.id, site.site_name]));
  const sitePolicyByScope = new Map<string, any>();
  for (const policy of sitePolicyResult.data || []) {
    const key = `${policy.organization_id}:${policy.site_id}`;
    if (!sitePolicyByScope.has(key)) sitePolicyByScope.set(key, policy);
  }
  const conflictCounts = new Map<string, number>();
  for (const policy of sitePolicyResult.data || []) {
    const key = `${policy.organization_id || ""}:__site_policy__:${policy.site_id || ""}`;
    conflictCounts.set(key, (conflictCounts.get(key) || 0) + 1);
  }
  const currentRows = rows
    .map((configuration: any) => {
      const sitePolicy = sitePolicyByScope.get(`${configuration.organization_id}:${configuration.site_id}`) || null;
      const lockHours = Number(configuration.attendance_lock_hours);
      const backdateDays = sitePolicy?.backdated_window_days;
      return {
        id: configuration.id,
        organization_id: configuration.organization_id,
        company_id: configuration.company_id,
        company_name: companyNames.get(configuration.company_id) || null,
        site_id: configuration.site_id,
        site_name: siteNames.get(configuration.site_id) || null,
        attendance_system: configuration.attendance_system || sitePolicy?.attendance_system || null,
        attendance_system_label: configuration.attendance_system || sitePolicy?.attendance_system || null,
        lock_after_hours: Number.isFinite(lockHours) ? lockHours : null,
        lock_time_label: Number.isFinite(lockHours) ? `${lockHours} ${lockHours === 1 ? "hour" : "hours"} after day end` : "Not Configured",
        backdated_window_days: Number.isFinite(Number(backdateDays)) ? Number(backdateDays) : null,
        backdate_label: Number.isFinite(Number(backdateDays)) && Number(backdateDays) > 0
          ? `${Number(backdateDays)} ${Number(backdateDays) === 1 ? "Day" : "Days"}`
          : "Not Allowed",
        status: configuration.status,
        source_configuration_id: configuration.id,
        source_site_attendance_policy_id: sitePolicy?.id || null,
        source_site_attendance_policy_status: sitePolicy?.status || null,
        source_site_attendance_policy_effective_from: sitePolicy?.effective_from || null,
        source_site_attendance_policy_effective_to: sitePolicy?.effective_to || null,
      };
    })
    .filter((row: any) => row.company_name && row.site_name)
    .sort((left: any, right: any) => `${left.company_name} ${left.site_name}`.localeCompare(`${right.company_name} ${right.site_name}`));
  return {
    rows: currentRows,
    conflicts: Array.from(conflictCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([scope_key, count]) => ({ scope_key, active_current_count: count })),
  };
}

async function loadUserPermissionContext(access: any) {
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
  const roleById = new Map((rolesResult.data || []).map((role: any) => [role.id, role]));
  const rolesByUser = new Map<string, any[]>();
  for (const row of userRolesResult.data || []) {
    const role: any = roleById.get(row.role_id);
    if (!role || ["inactive", "deleted", "disabled"].includes(String(role.status || "").toLowerCase())) continue;
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), role]);
  }
  const rolePermsByRole = new Map<string, any[]>();
  for (const permission of rolePermissionsResult.data || []) rolePermsByRole.set(permission.role_id, [...(rolePermsByRole.get(permission.role_id) || []), permission]);
  const userPermsByUser = new Map<string, any[]>();
  for (const permission of userPermissionsResult.data || []) userPermsByUser.set(permission.user_id, [...(userPermsByUser.get(permission.user_id) || []), permission]);
  const assignmentsByUser = new Map<string, any[]>();
  for (const row of accessRowsResult.data || []) assignmentsByUser.set(row.user_id, [...(assignmentsByUser.get(row.user_id) || []), row]);

  function hasPermission(userId: string, moduleCode: string, actionCode: string) {
    const roles = rolesByUser.get(userId) || [];
    if (isWildcardRole(roles)) return true;
    const permissions = [
      ...roles.flatMap((role) => rolePermsByRole.get(role.id) || []),
      ...(userPermsByUser.get(userId) || []),
    ];
    const latest = new Map<string, any>();
    for (const permission of permissions) latest.set(`${permission.module_code}:${permission.action_code}`, permission);
    return Array.from(latest.values()).some((permission: any) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode && permission.action_code === actionCode)),
    );
  }

  function isInScope(userId: string, organizationId: string, companyId: string, siteId: string) {
    const roles = rolesByUser.get(userId) || [];
    if (isWildcardRole(roles)) return true;
    const assignments = assignmentsByUser.get(userId) || [];
    return assignments.some((row) =>
      row.organization_id === organizationId &&
      (!row.company_id || row.company_id === companyId) &&
      (!row.site_id || row.site_id === siteId),
    );
  }

  return { profiles: profilesResult.data || [], hasPermission, isInScope };
}

function classifyUsers(permissionContext: any, scope: { organizationId: string; companyId: string; siteId: string }) {
  return (permissionContext.profiles || []).map((profile: any) => {
    const inScope = permissionContext.isInScope(profile.id, scope.organizationId, scope.companyId, scope.siteId);
    return {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      label: displayUser(profile),
      site_hr_eligible: inScope &&
        permissionContext.hasPermission(profile.id, "labour_site_in", "add") &&
        permissionContext.hasPermission(profile.id, "labour_attendance", "add"),
      pm_eligible: inScope &&
        permissionContext.hasPermission(profile.id, "labour_daily_submission", "pm_approve"),
      override_eligible: inScope &&
        permissionContext.hasPermission(profile.id, "labour_attendance_policy", "override"),
    };
  }).sort((a: any, b: any) => a.label.localeCompare(b.label));
}

async function loadEmployeeCandidates(access: any, input: { organizationId: string; companyId?: string | null; siteId?: string | null; permissionContext?: any }) {
  const [employeesResult, profilesResult] = await Promise.all([
    access.admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id, employee_code, employee_name, email, status, user_id, hr_departments(department_name), hr_designations(designation_name), sites(site_name)")
      .eq("organization_id", input.organizationId)
      .order("employee_name", { ascending: true }),
    access.admin.from("profiles").select("id, email, full_name, status"),
  ]);
  if (employeesResult.error) throw employeesResult.error;
  if (profilesResult.error) throw profilesResult.error;
  const employees = employeesResult.data || [];
  const profiles = profilesResult.data || [];
  const activeEmployees = employees.filter((employee: any) => employee.status === "active");
  const activeProfiles = profiles.filter((profile: any) => profile.status === "active");
  const employeesByUserId = new Map<string, any[]>();
  for (const employee of employees) {
    if (employee.user_id) employeesByUserId.set(employee.user_id, [...(employeesByUserId.get(employee.user_id) || []), employee]);
  }
  const safeEmailCounts = new Map<string, number>();
  for (const profile of profiles || []) {
    const email = lowerEmail(profile.email);
    if (email) safeEmailCounts.set(email, (safeEmailCounts.get(email) || 0) + 1);
  }
  const employeeEmailCounts = new Map<string, number>();
  for (const employee of employees || []) {
    const email = lowerEmail(employee.email);
    if (email) employeeEmailCounts.set(email, (employeeEmailCounts.get(email) || 0) + 1);
  }
  const profileById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const consumedEmployeeIds = new Set<string>();
  function activeEmployeeForProfile(profile: any) {
    const directRows = employeesByUserId.get(profile.id) || [];
    const activeDirect = directRows.find((employee: any) => employee.status === "active");
    if (activeDirect) return { employee: activeDirect, method: "user_id", status: "ERP Enabled" };
    const deletedDirect = directRows.find((employee: any) => employee.status === "deleted");
    if (deletedDirect) return { employee: deletedDirect, method: "deleted_user_id", status: "ERP Enabled — Employee Record Deleted" };
    const email = lowerEmail(profile.email);
    if (email && safeEmailCounts.get(email) === 1 && employeeEmailCounts.get(email) === 1) {
      const emailEmployee = employees.find((employee: any) => lowerEmail(employee.email) === email);
      if (emailEmployee?.status === "active") return { employee: emailEmployee, method: "safe_unique_email", status: "Employee/Profile Link Missing" };
      if (emailEmployee?.status === "deleted") return { employee: emailEmployee, method: "deleted_safe_unique_email", status: "ERP Enabled — Employee Record Deleted" };
    }
    return { employee: null, method: "profile_only", status: "ERP Enabled — No Employee Record" };
  }
  function candidateFromProfile(profile: any) {
    const match = activeEmployeeForProfile(profile);
    const employee: any = match.employee;
    if (employee?.id) consumedEmployeeIds.add(employee.id);
    const erpEnabled = true;
    const siteHrEligible = erpEnabled && input.permissionContext && input.siteId && input.companyId
      ? input.permissionContext.isInScope(profile.id, input.organizationId, input.companyId, input.siteId)
      : false;
    return {
      id: profile.id,
      candidate_id: profile.id,
      employee_id: employee?.status === "active" ? employee.id : null,
      source_employee_id: employee?.id || null,
      linked_user_id: profile.id,
      user_id: profile.id,
      employee_code: employee?.employee_code || null,
      employee_name: employee?.employee_name || profileDisplay(profile),
      profile_name: profileDisplay(profile),
      department: employee?.hr_departments?.department_name || null,
      designation: employee?.hr_designations?.designation_name || null,
      site_label: employee ? (employee.sites?.site_name || "Head Office") : "No Active Employee Record",
      email: profile?.email || null,
      full_name: profile?.full_name || null,
      erp_enabled: erpEnabled,
      erp_status: match.status,
      ineligibility_reason: null,
      site_hr_eligible: siteHrEligible,
      pm_eligible: erpEnabled,
      ho_hr_eligible: erpEnabled,
      link_resolution: match.method,
      label: employee ? displayEmployee(employee, profile) : `${profileDisplay(profile)} — ${profile.email || "No Email"} — ${match.status}`,
    };
  }
  function candidateFromEmployee(employee: any) {
    const directProfile: any = employee.user_id ? profileById.get(employee.user_id) : null;
    const status = directProfile ? "Inactive ERP Login" : "No ERP Login";
    return {
      id: employee.id,
      candidate_id: employee.id,
      employee_id: employee.id,
      source_employee_id: employee.id,
      linked_user_id: null,
      user_id: null,
      employee_code: employee.employee_code,
      employee_name: employee.employee_name,
      profile_name: null,
      department: employee.hr_departments?.department_name || null,
      designation: employee.hr_designations?.designation_name || null,
      site_label: employee.sites?.site_name || "Head Office",
      email: employee.email || null,
      full_name: null,
      erp_enabled: false,
      erp_status: status,
      ineligibility_reason: status === "Inactive ERP Login" ? "ERP login exists but is not active." : "Create or link an ERP login for this employee before assignment.",
      site_hr_eligible: false,
      pm_eligible: false,
      ho_hr_eligible: false,
      link_resolution: directProfile ? "inactive_user_id" : "employee_only",
      label: displayEmployee(employee, directProfile),
    };
  }
  const candidates = [
    ...activeProfiles.map(candidateFromProfile),
    ...activeEmployees.filter((employee: any) => !consumedEmployeeIds.has(employee.id)).map(candidateFromEmployee),
  ];
  return candidates.sort((a: any, b: any) => Number(b.erp_enabled) - Number(a.erp_enabled) || String(a.employee_name || a.profile_name || "").localeCompare(String(b.employee_name || b.profile_name || "")));
}

async function loadOverrideAuthorities(access: any, input: { organizationId: string; companyId: string; siteId: string }) {
  const { data, error } = await access.admin
    .from("labour_site_override_authorities")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .order("assigned_at", { ascending: false });
  if (error && error.code !== "42P01") throw error;
  return data || [];
}

async function loadApprovalLayers(access: any, input: { configurationId?: string | null; organizationId: string; companyId: string; siteId: string; workflowVersion?: number | null }) {
  if (!input.configurationId) return [];
  let query = access.admin
    .from("labour_site_approval_layers")
    .select("*")
    .eq("configuration_id", input.configurationId)
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .order("layer_sequence", { ascending: true });
  if (input.workflowVersion) query = query.eq("workflow_version", input.workflowVersion);
  const { data, error } = await query;
  if (error && error.code !== "42P01" && error.code !== "42703") throw error;
  return error ? [] : data || [];
}

async function loadConfigurationEvents(access: any, input: { configurationId?: string | null; organizationId: string; companyId: string; siteId: string }) {
  const { data, error } = await access.admin
    .from("labour_site_configuration_events")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error && error.code !== "42P01") throw error;
  return error ? [] : data || [];
}

async function resolveLayerApprover(access: any, candidates: any[], input: { userId?: string | null }, label: string) {
  const userId = text(input.userId);
  if (!userId) return { error: `${label} approver is required.` };
  const candidate = candidates.find((item: any) => item.linked_user_id === userId);
  if (!candidate) return { error: `${label} approver is not available for this Site.` };
  if (!candidate.erp_enabled || !candidate.user_id) return { error: `${label} approver must have an active ERP login.` };
  return { employeeId: candidate.employee_id || null, userId: candidate.user_id };
}

function approvalLayerCount(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[1-5]$/.test(raw)) return null;
  return Number(raw);
}

function normalizeApprovalLayers(value: unknown, layerCount: number) {
  const rows = Array.isArray(value) ? value : [];
  const normalized = rows.slice(0, layerCount).map((row: any, index: number) => ({
    layer_sequence: index + 1,
    stage_name: text(row?.stage_name),
    approver_user_id: text(row?.approver_user_id || row?.user_id),
  }));
  while (normalized.length < layerCount) {
    normalized.push({ layer_sequence: normalized.length + 1, stage_name: null, approver_user_id: null });
  }
  return normalized;
}

async function buildCandidateDiagnostics(candidates: any[]) {
  return {
    total_candidates: candidates.length,
    total_active_profiles: candidates.filter((candidate) => candidate.erp_enabled).length,
    total_visible_employee_only_records: candidates.filter((candidate) => candidate.link_resolution === "employee_only").length,
    active_profiles_without_employee_record: candidates.filter((candidate) => candidate.link_resolution === "profile_only").length,
    profiles_linked_to_deleted_employee_records: candidates.filter((candidate) => ["deleted_user_id", "deleted_safe_unique_email"].includes(candidate.link_resolution)).length,
    active_employees_with_no_profile: candidates.filter((candidate) => candidate.link_resolution === "employee_only").length,
    active_employees_with_linked_active_erp_profiles: candidates.filter((candidate) => candidate.link_resolution === "user_id" && candidate.erp_enabled).length,
    active_employees_with_missing_user_id: candidates.filter((candidate) => ["employee_only", "safe_unique_email"].includes(candidate.link_resolution)).length,
    employees_with_inactive_profiles: candidates.filter((candidate) => candidate.erp_status === "Inactive ERP Login").length,
    safe_unique_email_matches_where_link_missing: candidates.filter((candidate) => candidate.link_resolution === "safe_unique_email").length,
    eligible_pm_candidates: candidates.filter((candidate) => candidate.pm_eligible).length,
    eligible_ho_hr_candidates: candidates.filter((candidate) => candidate.ho_hr_eligible).length,
  };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_muster_configuration", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const lookups = await loadConfigurationLookups(access);
    const attendancePolicySummary = await loadAttendancePolicyRows(access);
    if (!companyId || !siteId) return NextResponse.json({ ...lookups, attendance_policies: attendancePolicySummary.rows, attendance_policy_conflicts: attendancePolicySummary.conflicts, configuration: null, users: [], override_authorities: [] });
    const requestedOrganizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const scope = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is not available.", 403);
    const resolved = { organizationId: scope.organizationId, companyId, siteId };
    const [configuration, siteAttendanceSystemPolicy, organizationConfiguration, permissionContext, overrideAuthorities] = await Promise.all([
      getActiveMusterConfiguration(access, resolved),
      getActiveSiteAttendanceSystemPolicy(access, { organizationId: scope.organizationId, siteId }),
      getActiveLabourOrganizationConfiguration(access, { organizationId: scope.organizationId }),
      loadUserPermissionContext(access),
      loadOverrideAuthorities(access, resolved),
    ]);
    const [approvalLayers, configurationEvents, siteHrUserIds] = await Promise.all([
      loadApprovalLayers(access, {
        configurationId: configuration?.id,
        organizationId: scope.organizationId,
        companyId,
        siteId,
        workflowVersion: configuration?.approval_workflow_version,
      }),
      loadConfigurationEvents(access, {
        configurationId: configuration?.id,
        organizationId: scope.organizationId,
        companyId,
        siteId,
      }),
      loadActiveSiteHrUserIds(access.admin, { ...resolved, fallbackUserId: configuration?.site_hr_user_id }),
    ]);
    const employeeCandidates = await loadEmployeeCandidates(access, { organizationId: scope.organizationId, companyId, siteId, permissionContext });
    return NextResponse.json({
      ...lookups,
      attendance_policies: attendancePolicySummary.rows,
      attendance_policy_conflicts: attendancePolicySummary.conflicts,
      configuration: configuration ? { ...configuration, site_hr_user_ids: siteHrUserIds, attendance_system: siteAttendanceSystemPolicy?.attendance_system || null } : siteAttendanceSystemPolicy ? { site_hr_user_ids: siteHrUserIds, attendance_system: siteAttendanceSystemPolicy.attendance_system } : null,
      site_attendance_system_policy: siteAttendanceSystemPolicy,
      organization_configuration: organizationConfiguration,
      approval_layers: approvalLayers,
      configuration_events: configurationEvents,
      users: classifyUsers(permissionContext, resolved),
      employee_candidates: employeeCandidates,
      diagnostics: await buildCandidateDiagnostics(employeeCandidates),
      override_authorities: overrideAuthorities,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Muster Configuration.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_muster_configuration", "view");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    if (!companyId || !siteId) return jsonError("Company and site are required.");
    const scope = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is not available.", 403);
    const organizationId = scope.organizationId;
    const siteHrUserIds = Array.from(new Set((Array.isArray(payload.site_hr_user_ids) ? payload.site_hr_user_ids : [payload.site_hr_user_id]).map(text).filter(Boolean))) as string[];
    const attendanceSystem = attendanceSystemValue(payload.attendance_system);
    const layerCount = approvalLayerCount(payload.approval_layer_count);
    const overrideUserIds: string[] = Array.from(
      new Set((Array.isArray(payload.override_user_ids) ? payload.override_user_ids : []).map(text).filter((value: string | null): value is string => Boolean(value))),
    );
    const lockHours = wholeHours(payload.attendance_lock_hours);
    if (lockHours === null) return jsonError("Attendance Lock Hours must be a non-negative whole number.");
    if (!attendanceSystem || attendanceSystem === "__invalid__") return jsonError("Attendance System is required.");
    const existingSitePolicy = await getActiveSiteAttendanceSystemPolicy(access, { organizationId, siteId });
    if (layerCount === null) return jsonError("Approval layer count must be between 1 and 5.");
    if (!hasLabourPermission(access, "labour_muster_configuration", "edit_attendance_policy")) return jsonError("You cannot edit Attendance lock policy.", 403);
    if (siteHrUserIds.length && !hasLabourPermission(access, "labour_muster_configuration", "edit_site_responsibility")) return jsonError("You cannot edit Site responsibility.", 403);
    if (payload.override_user_ids !== undefined && !hasLabourPermission(access, "labour_muster_configuration", "assign_override_authority")) return jsonError("You cannot assign Attendance override authority.", 403);

    const permissionContext = await loadUserPermissionContext(access);
    const users = classifyUsers(permissionContext, { organizationId, companyId, siteId });
    const userById = new Map<string, any>(users.map((user: any) => [user.id, user]));
    const employeeCandidates = await loadEmployeeCandidates(access, { organizationId, companyId, siteId, permissionContext });
    const employeeByUserId = new Map(employeeCandidates.filter((employee: any) => employee.linked_user_id).map((employee: any) => [employee.linked_user_id, employee]));
    for (const siteHrUserId of siteHrUserIds) {
      const siteHrCandidate: any = employeeByUserId.get(siteHrUserId);
      if (!siteHrCandidate?.site_hr_eligible || !userById.get(siteHrUserId)?.site_hr_eligible) return jsonError(siteHrCandidate?.ineligibility_reason || "Selected Site HR must be active, site-scoped and have Site-In/Attendance permissions.", 403);
    }
    const incomingLayers = normalizeApprovalLayers(payload.approval_layers, layerCount);
    const resolvedLayers = [];
    for (const layer of incomingLayers) {
      if (!layer.stage_name) return jsonError(`Stage name is required for Layer ${layer.layer_sequence}.`);
      const approver = await resolveLayerApprover(access, employeeCandidates, { userId: layer.approver_user_id }, `Layer ${layer.layer_sequence}`);
      if ("error" in approver) return jsonError(approver.error || `Layer ${layer.layer_sequence} approver is not available.`, 403);
      resolvedLayers.push({
        layer_sequence: layer.layer_sequence,
        stage_name: layer.stage_name,
        approver_user_id: approver.userId,
        approver_employee_id: approver.employeeId,
      });
    }
    const firstLayerApprover = resolvedLayers[0] || { approver_user_id: null, approver_employee_id: null };
    const finalLayerApprover = resolvedLayers[resolvedLayers.length - 1] || { approver_user_id: null, approver_employee_id: null };
    for (const userId of overrideUserIds) {
      if (!userById.get(userId)?.override_eligible) return jsonError("Override authority must be active, site-scoped and have Attendance override permission.", 403);
    }

    const existing = await getActiveMusterConfiguration(access, { organizationId, companyId, siteId });
    const existingLayers = await loadApprovalLayers(access, {
      configurationId: existing?.id,
      organizationId,
      companyId,
      siteId,
      workflowVersion: existing?.approval_workflow_version,
    });
    const existingLayerSignature = JSON.stringify((existingLayers || []).map((row: any) => ({
      layer_sequence: row.layer_sequence,
      stage_name: row.stage_name,
      approver_user_id: row.approver_user_id,
    })));
    const nextLayerSignature = JSON.stringify(resolvedLayers.map((row) => ({
      layer_sequence: row.layer_sequence,
      stage_name: row.stage_name,
      approver_user_id: row.approver_user_id,
    })));
    const workflowChanged = !existing || existing.approval_layer_count !== layerCount || existingLayerSignature !== nextLayerSignature;
    const workflowVersion = workflowChanged ? Number(existing?.approval_workflow_version || 1) + (existing ? 1 : 0) : Number(existing?.approval_workflow_version || 1);
    const configPayload = {
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      site_hr_user_id: siteHrUserIds[0] || null,
      pm_user_id: firstLayerApprover.approver_user_id,
      attendance_system: attendanceSystem,
      attendance_lock_hours: lockHours,
      approval_layer_count: layerCount,
      approval_workflow_version: workflowVersion,
      post_lock_correction_enabled: true,
      status: "active",
    };
    const result = existing
      ? await access.admin.from("labour_site_configurations").update({ ...configPayload, ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
      : await access.admin.from("labour_site_configurations").insert({ ...configPayload, ...actorFields(access.auth, "created") }).select("id").single();
    if (result.error) throw result.error;

    const assignmentQuery = access.admin.from("site_hr_assignments");
    const existingAssignments = await assignmentQuery.select("id,user_id,status").eq("organization_id", organizationId).eq("company_id", companyId).eq("site_id", siteId);
    if (existingAssignments.error && existingAssignments.error.code !== "42P01") throw existingAssignments.error;
    if (!existingAssignments.error) {
      const selected = new Set(siteHrUserIds);
      const stale = (existingAssignments.data || []).filter((row: any) => row.status === "active" && !selected.has(row.user_id));
      if (stale.length) {
        const { error } = await assignmentQuery.update({ status: "inactive", ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).in("id", stale.map((row: any) => row.id));
        if (error) throw error;
      }
      const rows = existingAssignments.data || [];
      for (const userId of siteHrUserIds) {
        const matchingRows = rows.filter((row: any) => row.user_id === userId);
        if (matchingRows.some((row: any) => row.status === "active")) continue;
        const inactiveRow = matchingRows.find((row: any) => row.status !== "active");
        if (inactiveRow) {
          const { error } = await assignmentQuery.update({ status: "active", ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).eq("id", inactiveRow.id);
          if (error) throw error;
          continue;
        }
        const { error } = await assignmentQuery.insert({ organization_id: organizationId, company_id: companyId, site_id: siteId, user_id: userId, status: "active", ...actorFields(access.auth, "created") });
        if (error) throw error;
      }
    }

    const configId = result.data.id;
    if (!existingSitePolicy || existingSitePolicy.attendance_system !== attendanceSystem) {
      if (existingSitePolicy) {
        const { error } = await access.admin
          .from("labour_site_attendance_policies")
          .update({ status: "ended", effective_to: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
          .eq("id", existingSitePolicy.id);
        if (error) throw error;
      }
      const { error } = await access.admin
        .from("labour_site_attendance_policies")
        .insert({
          organization_id: organizationId,
          company_id: null,
          site_id: siteId,
          attendance_system: attendanceSystem,
          status: "active",
          effective_from: new Date().toISOString().slice(0, 10),
          changed_reason: existingSitePolicy?.attendance_system ? "Attendance system updated from Muster Configuration." : "Initial Site attendance system configuration.",
          ...actorFields(access.auth, "created"),
        });
      if (error) throw error;
    }
    if (workflowChanged && existingLayers.length) {
      const { error } = await access.admin
        .from("labour_site_approval_layers")
        .update({ status: "inactive", ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() })
        .eq("configuration_id", configId)
        .eq("status", "active");
      if (error && error.code !== "42P01") throw error;
    }
    if (workflowChanged) {
      const layerRows = resolvedLayers.map((layer) => ({
        configuration_id: configId,
        organization_id: organizationId,
        company_id: companyId,
        site_id: siteId,
        workflow_version: workflowVersion,
        layer_sequence: layer.layer_sequence,
        stage_name: layer.stage_name,
        approver_user_id: layer.approver_user_id,
        approver_employee_id: layer.approver_employee_id,
        status: "active",
        ...actorFields(access.auth, "created"),
      }));
      const { error } = await access.admin.from("labour_site_approval_layers").insert(layerRows);
      if (error) throw error;
    }
    const existingOrgConfig = await getActiveLabourOrganizationConfiguration(access, { organizationId });
    const orgConfigPayload = {
      organization_id: organizationId,
      ho_hr_employee_id: finalLayerApprover.approver_employee_id,
      ho_hr_user_id: finalLayerApprover.approver_user_id,
      status: "active",
    };
    const orgResult = existingOrgConfig
      ? await access.admin.from("labour_organization_configurations").update({ ...orgConfigPayload, ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).eq("id", existingOrgConfig.id).select("id").single()
      : await access.admin.from("labour_organization_configurations").insert({ ...orgConfigPayload, ...actorFields(access.auth, "created") }).select("id").single();
    if (orgResult.error) throw orgResult.error;
    const currentOverrides = await loadOverrideAuthorities(access, { organizationId, companyId, siteId });
    const currentOverrideIds = new Set(currentOverrides.map((row: any) => row.user_id));
    const nextOverrideIds = new Set(overrideUserIds);
    const toCancel = currentOverrides.filter((row: any) => !nextOverrideIds.has(row.user_id)).map((row: any) => row.id);
    if (toCancel.length) {
      const { error } = await access.admin.from("labour_site_override_authorities").update({ status: "cancelled", ...actorFields(access.auth, "updated"), updated_at: new Date().toISOString() }).in("id", toCancel);
      if (error) throw error;
    }
    const toInsert = overrideUserIds.filter((userId) => !currentOverrideIds.has(userId));
    if (toInsert.length) {
      const rows = toInsert.map((userId) => ({
        configuration_id: configId,
        organization_id: organizationId,
        company_id: companyId,
        site_id: siteId,
        user_id: userId,
        status: "active",
        assigned_by: access.auth.user.id,
        assigned_by_name: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
        assigned_by_email: access.auth.user.email || null,
      }));
      const { error } = await access.admin.from("labour_site_override_authorities").insert(rows);
      if (error) throw error;
    }

    await audit(access, request, {
      moduleCode: "labour_muster_configuration",
      action: existing ? "update" : "create",
      entityType: "labour_site_configuration",
      recordId: configId,
      organizationId,
      companyId,
      siteId,
      description: existing ? "Updated Muster Configuration." : "Created Muster Configuration.",
      oldValues: existing ? { site_configuration: existing, organization_configuration: existingOrgConfig, override_user_ids: currentOverrides.map((row: any) => row.user_id) } : null,
      newValues: { site_configuration: configPayload, organization_configuration: orgConfigPayload, override_user_ids: overrideUserIds },
    });
    await access.admin.from("labour_site_configuration_events").insert({
      configuration_id: configId,
      organization_id: organizationId,
      company_id: companyId,
      site_id: siteId,
      event_type: existing ? "configuration_updated" : "configuration_created",
      previous_values: existing ? { site_configuration: existing, approval_layers: existingLayers, organization_configuration: existingOrgConfig, override_user_ids: currentOverrides.map((row: any) => row.user_id) } : null,
      new_values: { site_configuration: configPayload, approval_layers: resolvedLayers, organization_configuration: orgConfigPayload, override_user_ids: overrideUserIds },
      ...actorFields(access.auth, "created"),
    });
    return NextResponse.json({ configuration_id: configId });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save Muster Configuration.", 500);
  }
}
