import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { hasServerPermission, loadPermissionContext, requirePermission, requireAnyPermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  actorName,
  ATTENDANCE_STATUSES,
  canEditAttendanceDate,
  canSelectAttendanceDate,
  canLockAttendanceDate,
  currentIndiaDate,
  datesForMonth,
  EMPLOYEE_STANDARD_WORKING_HOURS,
  isAfterEmployeeAttendanceLockCutoff,
  hasMonthEnded,
  HR_ATTENDANCE_APPROVAL_MODULE,
  HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE,
  HR_ATTENDANCE_MODULE,
  isAdminRecoveryRole,
  isAttendanceStatus,
  isEmployeeEligibleForDate,
  monthEnd,
  monthStart,
  normalizeIsoDate,
  summarizeAttendance,
} from "@/lib/hr/attendance";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireAttendancePermission(request: Request, action: string) {
  return requirePermission(request, HR_ATTENDANCE_MODULE, action);
}

export async function requireAttendanceWrite(request: Request) {
  return requireAnyPermission(request, [
    { moduleCode: HR_ATTENDANCE_MODULE, actionCode: "add" },
    { moduleCode: HR_ATTENDANCE_MODULE, actionCode: "edit" },
  ]);
}

export async function requireAttendanceApprovalPermission(request: Request, action: string) {
  return requirePermission(request, HR_ATTENDANCE_APPROVAL_MODULE, action);
}

export async function requireAttendanceApprovalActor(request: Request) {
  return loadPermissionContext(request);
}

export function hasAttendanceApprovalPermission(auth: ServerPermissionContext, action: string) {
  return hasServerPermission(auth, HR_ATTENDANCE_APPROVAL_MODULE, action);
}

export async function requireAttendanceView(request: Request) {
  return requirePermission(request, HR_ATTENDANCE_MODULE, "view");
}

export async function requireAttendancePolicyView(request: Request) {
  return requirePermission(request, HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE, "view");
}

export async function requireAttendancePolicyWrite(request: Request) {
  return requireAnyPermission(request, [
    { moduleCode: HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE, actionCode: "add" },
    { moduleCode: HR_EMPLOYEE_ATTENDANCE_POLICY_MODULE, actionCode: "edit" },
  ]);
}

export async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("organization_id, company_id, site_id")
    .eq("user_id", userId);
  if (error) throw error;
  return {
    rows: data || [],
    companyIds: Array.from(new Set((data || []).map((row: any) => row.company_id).filter(Boolean))) as string[],
    siteIds: Array.from(new Set((data || []).map((row: any) => row.site_id).filter(Boolean))) as string[],
  };
}

function rowAppliesToDateRange(row: any, startDate: string, endDate: string) {
  const effectiveFrom = row.effective_from || row.event_date || null;
  const effectiveTo = row.effective_to || null;
  if (effectiveFrom && effectiveFrom > endDate) return false;
  if (effectiveTo && effectiveTo < startDate) return false;
  return true;
}

function assignmentMatchesAccess(
  assignment: { organization_id?: string | null; company_id?: string | null; site_id?: string | null },
  accessRows: any[],
) {
  if (accessRows.length === 0) return false;
  return accessRows.some((access) => {
    if (access.organization_id && assignment.organization_id && access.organization_id !== assignment.organization_id) return false;
    if (access.company_id && access.company_id !== assignment.company_id) return false;
    if (access.site_id && access.site_id !== assignment.site_id) return false;
    return true;
  });
}

function policyScopeMatchesAccess(
  scope: { organization_id?: string | null; company_id?: string | null; site_id?: string | null },
  accessRows: any[],
) {
  if (accessRows.length === 0) return false;
  return accessRows.some((access) => {
    if (access.organization_id && scope.organization_id && access.organization_id !== scope.organization_id) return false;
    if (access.company_id && access.company_id !== scope.company_id) return false;
    if (access.site_id && access.site_id !== scope.site_id) return false;
    return true;
  });
}

export async function loadEmployeeAttendanceLookups(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const assignments = isGlobalScope(organizationScope) ? { rows: [] as any[] } : await loadActorAssignments(admin, auth.user.id);

  let employeeQuery = admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, status, date_of_joining, date_of_exit")
    .neq("status", "deleted")
    .not("company_id", "is", null)
    .not("site_id", "is", null);
  const scopedEmployeeQuery = applyOrganizationScope(employeeQuery, organizationScope);
  if (!scopedEmployeeQuery) return { companies: [], sites: [], pairs: [] };
  const { data: employeeRows, error: employeeError } = await scopedEmployeeQuery;
  if (employeeError) throw employeeError;

  let historyQuery = admin
    .from("employee_employment_history")
    .select("organization_id, employee_id, company_id, site_id, employment_status, effective_from, effective_to, event_date, created_at")
    .not("company_id", "is", null)
    .not("site_id", "is", null);
  const scopedHistoryQuery = applyOrganizationScope(historyQuery, organizationScope);
  const { data: historyRows, error: historyError } = scopedHistoryQuery
    ? await scopedHistoryQuery
    : { data: [], error: null };
  if (historyError) throw historyError;

  let policyQuery = admin
    .from("employee_attendance_policies")
    .select("*")
    .neq("status", "deleted");
  const scopedPolicyQuery = applyOrganizationScope(policyQuery, organizationScope);
  const { data: policyRows, error: policyError } = scopedPolicyQuery
    ? await scopedPolicyQuery
    : { data: [], error: null };
  if (policyError) throw policyError;

  const today = currentIndiaDate();
  const activeEmployees = (employeeRows || []).filter((row: any) => {
    const status = String(row.status || "").toLowerCase();
    return status !== "deleted" && status !== "inactive" && isEmployeeEligibleForDate(row, today);
  });
  const activeEmployeeIds = new Set(activeEmployees.map((row: any) => row.id).filter(Boolean));
  const currentHistoryRows = (historyRows || [])
    .filter((row: any) => activeEmployeeIds.has(row.employee_id))
    .filter((row: any) => rowAppliesToDateRange(row, today, today))
    .filter((row: any) => {
      const status = String(row.employment_status || "active").toLowerCase();
      return status !== "deleted" && status !== "inactive" && status !== "terminated";
    })
    .sort((left: any, right: any) => {
      const leftDate = String(left.effective_from || left.event_date || "");
      const rightDate = String(right.effective_from || right.event_date || "");
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right.created_at || "").localeCompare(String(left.created_at || ""));
    });
  const historyByEmployee = new Map<string, any>();
  for (const row of currentHistoryRows) {
    if (!historyByEmployee.has(row.employee_id)) historyByEmployee.set(row.employee_id, row);
  }
  const employeeRowsWithoutUsableHistory = activeEmployees.filter((row: any) => !historyByEmployee.has(row.id));

  const pairMap = new Map<string, any>();
  const addPair = (row: any, source: "employee_assignment" | "employment_history" | "attendance_policy") => {
    if (!row?.organization_id || !row?.company_id || !row?.site_id) return;
    if (String(row.employment_status || "").toLowerCase() === "deleted") return;
    if (!isGlobalScope(organizationScope) && !assignmentMatchesAccess(row, assignments.rows)) return;
    const key = `${row.organization_id}:${row.company_id}:${row.site_id}`;
    pairMap.set(key, {
      ...(pairMap.get(key) || {}),
      organization_id: row.organization_id,
      company_id: row.company_id,
      site_id: row.site_id,
      sources: Array.from(new Set([...(pairMap.get(key)?.sources || []), source])),
      attendance_method: row.attendance_method || pairMap.get(key)?.attendance_method || "manual_hr_entry",
      approval_workflow_code: row.approval_workflow_code || pairMap.get(key)?.approval_workflow_code || "employee_attendance_period_approval",
      attendance_lock_rule: row.attendance_lock_rule || pairMap.get(key)?.attendance_lock_rule || "finalized_period",
      approval_level_count: Number.isInteger(Number(row.approval_level_count)) ? Number(row.approval_level_count) : pairMap.get(key)?.approval_level_count ?? 1,
      approval_workflow_version: Number(row.approval_workflow_version || pairMap.get(key)?.approval_workflow_version || 1),
      lock_after_hours: Number.isInteger(Number(row.lock_after_hours)) ? Number(row.lock_after_hours) : pairMap.get(key)?.lock_after_hours ?? 5,
      policy_status: row.status || pairMap.get(key)?.policy_status || null,
    });
  };

  for (const row of historyByEmployee.values()) addPair(row, "employment_history");
  for (const row of employeeRowsWithoutUsableHistory) addPair(row, "employee_assignment");
  for (const row of policyRows || []) addPair(row, "attendance_policy");

  const pairs = Array.from(pairMap.values());
  const companyIds = Array.from(new Set(pairs.map((pair) => pair.company_id)));
  const siteIds = Array.from(new Set(pairs.map((pair) => pair.site_id)));

  const [companyResult, siteResult] = await Promise.all([
    companyIds.length
      ? admin.from("companies").select("id, company_name, company_code").in("id", companyIds).neq("status", "deleted")
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds).neq("status", "deleted")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (companyResult.error) throw companyResult.error;
  if (siteResult.error) throw siteResult.error;

  const companyNames = new Map((companyResult.data || []).map((row: any) => [row.id, row.company_name || row.company_code || "Company"]));
  const siteNames = new Map((siteResult.data || []).map((row: any) => [row.id, row.site_name || row.site_code || "Site"]));
  const visiblePairs = pairs
    .filter((pair) => companyNames.has(pair.company_id) && siteNames.has(pair.site_id))
    .map((pair) => ({
      ...pair,
      company_name: companyNames.get(pair.company_id),
      site_name: siteNames.get(pair.site_id),
    }))
    .sort((left, right) => `${left.company_name} ${left.site_name}`.localeCompare(`${right.company_name} ${right.site_name}`));
  const uniqueSites = Array.from(new Map(visiblePairs.map((pair) => [pair.site_id, pair])).values()).map((site) => ({
    id: site.site_id,
    label: site.site_name,
    organization_id: site.organization_id,
    company_ids: Array.from(new Set(visiblePairs.filter((pair) => pair.site_id === site.site_id).map((pair) => pair.company_id))),
  }));

  return {
    pairs: visiblePairs,
    companies: companyIds
      .filter((id) => visiblePairs.some((pair) => pair.company_id === id))
      .map((id) => ({ id, label: companyNames.get(id) || id }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    sites: uniqueSites,
  };
}

export async function loadEmployeeAttendancePolicyLookups(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const assignments = isGlobalScope(organizationScope) ? { rows: [] as any[] } : await loadActorAssignments(admin, auth.user.id);

  let companyQuery = admin
    .from("companies")
    .select("id, organization_id, company_name, company_code")
    .eq("status", "active");
  const scopedCompanyQuery = applyOrganizationScope(companyQuery, organizationScope);
  if (!scopedCompanyQuery) return { companies: [], sites: [], pairs: [] };

  let siteQuery = admin
    .from("sites")
    .select("id, organization_id, site_name, site_code")
    .eq("status", "active");
  const scopedSiteQuery = applyOrganizationScope(siteQuery, organizationScope);
  if (!scopedSiteQuery) return { companies: [], sites: [], pairs: [] };

  const [{ data: companyRows, error: companyError }, { data: siteRows, error: siteError }] = await Promise.all([
    scopedCompanyQuery.order("company_name", { ascending: true }),
    scopedSiteQuery.order("site_name", { ascending: true }),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;

  const pairMap = new Map<string, any>();
  for (const company of companyRows || []) {
    for (const site of siteRows || []) {
      if (!company.organization_id || company.organization_id !== site.organization_id) continue;
      const pair = {
        organization_id: company.organization_id,
        company_id: company.id,
        site_id: site.id,
        company_name: company.company_name || company.company_code || "Company",
        site_name: site.site_name || site.site_code || "Site",
      };
      if (!isGlobalScope(organizationScope) && !policyScopeMatchesAccess(pair, assignments.rows)) continue;
      pairMap.set(`${pair.organization_id}:${pair.company_id}:${pair.site_id}`, pair);
    }
  }

  const pairs = Array.from(pairMap.values()).sort((left, right) =>
    `${left.company_name} ${left.site_name}`.localeCompare(`${right.company_name} ${right.site_name}`),
  );
  const companies = Array.from(
    new Map(pairs.map((pair) => [pair.company_id, { id: pair.company_id, label: pair.company_name }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));

  return {
    pairs,
    companies,
    sites: pairs.map((pair) => ({
      id: pair.site_id,
      label: pair.site_name,
      company_id: pair.company_id,
      scope_company_id: pair.company_id,
      organization_id: pair.organization_id,
    })),
  };
}

export async function loadEmployeeAttendancePolicyForScope(
  admin: ReturnType<typeof adminClient>,
  values: { organizationId: string; siteId: string },
) {
  const { data, error } = await admin
    .from("employee_attendance_policies")
    .select("*")
    .eq("organization_id", values.organizationId)
    .eq("site_id", values.siteId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let layers: any[] = [];
  let postLockEditors: any[] = [];
  if (data?.id) {
    const [layerResult, editorResult] = await Promise.all([
      admin
        .from("employee_attendance_policy_layers")
        .select("id, level_sequence, stage_name, approver_user_id, approver_employee_id, workflow_version, status")
        .eq("policy_id", data.id)
        .eq("workflow_version", data.approval_workflow_version || 1)
        .eq("status", "active")
        .order("level_sequence", { ascending: true }),
      admin
        .from("employee_attendance_post_lock_editors")
        .select("id, role_code, user_id, status")
        .eq("policy_id", data.id)
        .eq("status", "active"),
    ]);
    if (layerResult.error && layerResult.error.code !== "42P01") throw layerResult.error;
    if (editorResult.error && editorResult.error.code !== "42P01") throw editorResult.error;
    layers = layerResult.data || [];
    postLockEditors = (editorResult.data || []).filter((editor: any) => editor.user_id);
  }

  return {
    id: data?.id || null,
    organization_id: values.organizationId,
    company_id: data?.company_id || null,
    site_id: values.siteId,
    attendance_method: data?.attendance_method || "manual_hr_entry",
    approval_workflow_code: data?.approval_workflow_code || "employee_attendance_period_approval",
    attendance_lock_rule: data?.attendance_lock_rule || "finalized_period",
    approval_level_count: Number.isInteger(Number(data?.approval_level_count)) ? Number(data.approval_level_count) : 1,
    approval_workflow_version: Number(data?.approval_workflow_version || 1),
    lock_after_hours: Number.isInteger(Number(data?.lock_after_hours)) ? Number(data.lock_after_hours) : 5,
    status: data?.status || "not_configured",
    standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS,
    approval_layers: layers,
    post_lock_editors: postLockEditors,
  };
}

export function policySnapshot(policy: any) {
  const levelCount = Math.max(0, Math.min(3, Number(policy?.approval_level_count ?? 1)));
  const layers = Array.isArray(policy?.approval_layers)
    ? policy.approval_layers
        .filter((layer: any) => Number(layer.level_sequence) >= 1 && Number(layer.level_sequence) <= levelCount)
        .sort((left: any, right: any) => Number(left.level_sequence) - Number(right.level_sequence))
        .map((layer: any) => ({
          level_sequence: Number(layer.level_sequence),
          stage_name: layer.stage_name || `Level ${layer.level_sequence} Approval`,
          approver_user_id: layer.approver_user_id,
          approver_employee_id: layer.approver_employee_id || null,
        }))
    : [];
  return {
    standard_working_hours: EMPLOYEE_STANDARD_WORKING_HOURS,
    attendance_method: policy?.attendance_method || "manual_hr_entry",
    approval_level_count: levelCount,
    approval_workflow_version: Number(policy?.approval_workflow_version || 1),
    lock_after_hours: Number.isInteger(Number(policy?.lock_after_hours)) ? Number(policy.lock_after_hours) : 5,
    lock_reference: "attendance_day_end_2359_ist",
    approval_layers: layers,
    post_lock_editors: Array.isArray(policy?.post_lock_editors) ? policy.post_lock_editors.filter((editor: any) => editor.user_id) : [],
  };
}

export function nextApprovedStatusForLevel(level: number, totalLevels: number) {
  if (level >= totalLevels) return "finalized";
  return `level_${level}_approved`;
}

export function isCurrentLevelApprover(auth: ServerPermissionContext, snapshot: any, level: number) {
  return isCurrentLevelApprovalActor(auth, snapshot, level);
}

export function isCurrentLevelApprovalActor(auth: ServerPermissionContext, snapshot: any, level: number) {
  if (isAdminRecoveryRole(auth.roleCodes)) return true;
  const layer = (snapshot?.approval_layers || []).find((item: any) => Number(item.level_sequence) === level);
  return Boolean(layer?.approver_user_id && layer.approver_user_id === auth.user.id);
}

export function canReviewEmployeeAttendancePeriod(auth: ServerPermissionContext, period: any) {
  if (isAdminRecoveryRole(auth.roleCodes)) return true;
  const snapshot = period?.approval_workflow_snapshot || {};
  const totalLevels = Math.max(0, Math.min(3, Number(snapshot.approval_level_count ?? 0)));
  const currentLevel = Number(period?.current_approval_level || 0);
  if (totalLevels <= 0 || currentLevel <= 0) return false;
  return isCurrentLevelApprovalActor(auth, snapshot, currentLevel);
}

export function hasEmployeePostLockEditAuthority(auth: ServerPermissionContext, policy: any) {
  if (isAdminRecoveryRole(auth.roleCodes)) return true;
  const editors = Array.isArray(policy?.post_lock_editors) ? policy.post_lock_editors : [];
  return editors.some((editor: any) =>
    editor.user_id && editor.user_id === auth.user.id
  );
}

export function isEmployeeAttendanceLockedByPolicy(policy: any, attendanceDate: string) {
  return isAfterEmployeeAttendanceLockCutoff({
    attendanceDate,
    lockAfterHours: Number.isInteger(Number(policy?.lock_after_hours)) ? Number(policy.lock_after_hours) : 5,
  });
}

export async function validateCompanySiteScope(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  companyId: string,
  siteId: string,
) {
  if (!companyId) return { response: jsonError("Company is required.", 400) } as const;
  if (!siteId) return { response: jsonError("Site is required.", 400) } as const;

  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    admin.from("companies").select("id, organization_id, status").eq("id", companyId).neq("status", "deleted").maybeSingle(),
    admin.from("sites").select("id, organization_id, status").eq("id", siteId).neq("status", "deleted").maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company) return { response: jsonError("Selected company was not found.", 404) } as const;
  if (!site) return { response: jsonError("Selected site was not found.", 404) } as const;
  if (!isInOrganizationScope(organizationScope, company.organization_id)) {
    return { response: jsonError("Selected company is not available for this organization.", 403) } as const;
  }
  if (site.organization_id !== company.organization_id) {
    return { response: jsonError("Selected site is not available for this organization.", 403) } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    if (assignments.siteIds.length > 0 && !assignments.siteIds.includes(siteId)) {
      return { response: jsonError("Selected site is not available for this user.", 403) } as const;
    }
    if (assignments.siteIds.length === 0 && assignments.companyIds.length > 0 && !assignments.companyIds.includes(companyId)) {
      return { response: jsonError("Selected company is not available for this user.", 403) } as const;
    }
  }

  return { organizationId: company.organization_id as string, organizationScope } as const;
}

export async function validateEmployeeAttendancePolicyScope(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  companyId: string,
  siteId: string,
) {
  if (!companyId) return { response: jsonError("Company is required.", 400) } as const;
  if (!siteId) return { response: jsonError("Site is required.", 400) } as const;

  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    admin.from("companies").select("id, organization_id, status").eq("id", companyId).eq("status", "active").maybeSingle(),
    admin.from("sites").select("id, organization_id, status").eq("id", siteId).eq("status", "active").maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  if (!company) return { response: jsonError("Selected company was not found.", 404) } as const;
  if (!site) return { response: jsonError("Selected site was not found.", 404) } as const;
  if (!isInOrganizationScope(organizationScope, company.organization_id)) {
    return { response: jsonError("Selected company is not available for this organization.", 403) } as const;
  }
  if (site.organization_id !== company.organization_id) {
    return { response: jsonError("Selected site is not available for this organization.", 403) } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    if (!policyScopeMatchesAccess({
      organization_id: company.organization_id,
      company_id: companyId,
      site_id: siteId,
    }, assignments.rows)) {
      return { response: jsonError("Selected company/site scope is not available for this user.", 403) } as const;
    }
  }

  return { organizationId: company.organization_id as string, organizationScope } as const;
}

export async function validateEmployeeAttendancePolicySiteScope(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  siteId: string,
) {
  if (!siteId) return { response: jsonError("Site is required.", 400) } as const;
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const { data: site, error } = await admin
    .from("sites")
    .select("id, organization_id, status")
    .eq("id", siteId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!site) return { response: jsonError("Selected site was not found.", 404) } as const;
  if (!isInOrganizationScope(organizationScope, site.organization_id)) {
    return { response: jsonError("Selected site is not available for this organization.", 403) } as const;
  }
  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    if (!assignments.siteIds.includes(siteId)) {
      return { response: jsonError("Selected site is not available for this user.", 403) } as const;
    }
  }
  return { organizationId: site.organization_id as string, organizationScope } as const;
}

export async function ensurePeriod(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  values: { organizationId: string; companyId: string; siteId: string; month: string },
) {
  const { data: existing, error: existingError } = await admin
    .from("employee_attendance_periods")
    .select("*")
    .eq("organization_id", values.organizationId)
    .eq("company_id", values.companyId)
    .eq("site_id", values.siteId)
    .eq("period_month", values.month)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await admin
    .from("employee_attendance_periods")
    .insert({
      organization_id: values.organizationId,
      company_id: values.companyId,
      site_id: values.siteId,
      period_month: values.month,
      status: "draft",
      created_by: auth.user.id,
      created_by_name: actorName(auth.user),
      created_by_email: auth.user.email || null,
      updated_by: auth.user.id,
      updated_by_name: actorName(auth.user),
      updated_by_email: auth.user.email || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function loadEligibleEmployees(
  admin: ReturnType<typeof adminClient>,
  values: { organizationId: string; companyId: string; siteId: string; startDate: string; endDate: string },
) {
  const { data, error } = await admin
    .from("hr_employees")
    .select("id, employee_code, employee_name, department_id, designation_id, date_of_joining, date_of_exit, status, company_id, site_id")
    .eq("organization_id", values.organizationId)
    .neq("status", "deleted")
    .or(`date_of_joining.is.null,date_of_joining.lte.${values.endDate}`)
    .or(`date_of_exit.is.null,date_of_exit.gte.${values.startDate}`)
    .order("employee_name", { ascending: true });
  if (error) throw error;

  const employees = data || [];
  const employeeIds = employees.map((employee: any) => employee.id);
  const historyByEmployee = new Map<string, any[]>();

  if (employeeIds.length > 0) {
    const { data: historyRows, error: historyError } = await admin
      .from("employee_employment_history")
      .select("employee_id, company_id, site_id, effective_from, effective_to, event_date, employment_status")
      .eq("organization_id", values.organizationId)
      .in("employee_id", employeeIds)
      .or(`effective_from.is.null,effective_from.lte.${values.endDate}`)
      .or(`effective_to.is.null,effective_to.gte.${values.startDate}`)
      .order("effective_from", { ascending: false, nullsFirst: false })
      .order("event_date", { ascending: false, nullsFirst: false });
    if (historyError) throw historyError;
    for (const history of historyRows || []) {
      historyByEmployee.set(history.employee_id, [...(historyByEmployee.get(history.employee_id) || []), history]);
    }
  }

  return employees.filter((employee: any) => {
    const dateForEligibility = values.startDate === values.endDate ? values.startDate : values.endDate;
    if (!isEmployeeEligibleForDate(employee, dateForEligibility)) return false;

    const histories = historyByEmployee.get(employee.id) || [];
    const effectiveHistories = histories.filter((history) => rowAppliesToDateRange(history, values.startDate, values.endDate));
    const matchingHistory = effectiveHistories.find((history) =>
      history.company_id === values.companyId &&
      history.site_id === values.siteId &&
      String(history.employment_status || employee.status || "").toLowerCase() !== "deleted"
    );
    if (matchingHistory) return true;

    if (effectiveHistories.length > 0) {
      return false;
    }

    return employee.company_id === values.companyId && employee.site_id === values.siteId;
  });
}

export async function loadDayLock(
  admin: ReturnType<typeof adminClient>,
  values: { organizationId: string; companyId: string; siteId: string; attendanceDate: string },
) {
  const { data, error } = await admin
    .from("employee_attendance_day_locks")
    .select("*")
    .eq("organization_id", values.organizationId)
    .eq("company_id", values.companyId)
    .eq("site_id", values.siteId)
    .eq("attendance_date", values.attendanceDate)
    .eq("is_locked", true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function loadAttendanceRows(
  admin: ReturnType<typeof adminClient>,
  values: { organizationId: string; companyId: string; siteId: string; startDate: string; endDate: string },
) {
  const { data, error } = await admin
    .from("employee_attendance")
    .select("*")
    .eq("organization_id", values.organizationId)
    .eq("company_id", values.companyId)
    .eq("site_id", values.siteId)
    .gte("attendance_date", values.startDate)
    .lte("attendance_date", values.endDate);
  if (error) throw error;
  return data || [];
}

export async function loadDailySubmission(
  admin: ReturnType<typeof adminClient>,
  values: { organizationId: string; companyId: string; siteId: string; attendanceDate: string },
) {
  const { data, error } = await admin
    .from("employee_attendance_daily_submissions")
    .select("*")
    .eq("organization_id", values.organizationId)
    .eq("company_id", values.companyId)
    .eq("site_id", values.siteId)
    .eq("attendance_date", values.attendanceDate)
    .maybeSingle();
  if (error && error.code !== "42P01") throw error;
  return data || null;
}

export async function ensureDailySubmission(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  values: { organizationId: string; companyId: string; siteId: string; periodId: string; attendanceDate: string },
) {
  const existing = await loadDailySubmission(admin, values);
  if (existing) return existing;
  const { data, error } = await admin
    .from("employee_attendance_daily_submissions")
    .insert({
      organization_id: values.organizationId,
      company_id: values.companyId,
      site_id: values.siteId,
      period_id: values.periodId,
      attendance_date: values.attendanceDate,
      status: "draft",
      created_by: auth.user.id,
      created_by_name: actorName(auth.user),
      created_by_email: auth.user.email || null,
      updated_by: auth.user.id,
      updated_by_name: actorName(auth.user),
      updated_by_email: auth.user.email || null,
    })
    .select("*")
    .single();
  if (error && error.code === "23505") return loadDailySubmission(admin, values);
  if (error) throw error;
  return data;
}

export function isDailySubmissionEditable(state: any) {
  return !state || ["draft", "reopened"].includes(String(state.status || "").toLowerCase());
}

export async function filterAccessibleDailySubmissions(admin: ReturnType<typeof adminClient>, auth: ServerPermissionContext, rows: any[]) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const scopedRows = isGlobalScope(organizationScope) ? rows : rows.filter((row: any) => Array.isArray(organizationScope) && organizationScope.includes(row.organization_id));
  if (isGlobalScope(organizationScope)) return scopedRows;
  const assignments = await loadActorAssignments(admin, auth.user.id);
  return scopedRows.filter((row: any) => assignments.rows.some((assignment: any) =>
    (!assignment.organization_id || assignment.organization_id === row.organization_id) &&
    (!assignment.company_id || assignment.company_id === row.company_id) &&
    (!assignment.site_id || assignment.site_id === row.site_id),
  ));
}

export function parseDailyParams(url: string) {
  const params = new URL(url).searchParams;
  const companyId = String(params.get("company_id") || "").trim();
  const siteId = String(params.get("site_id") || "").trim();
  const attendanceDate = normalizeIsoDate(params.get("date"));
  if (!attendanceDate) return { error: "Valid attendance date is required." } as const;
  return { companyId, siteId, attendanceDate } as const;
}

export function parseMonthlyParams(url: string) {
  const params = new URL(url).searchParams;
  const companyId = String(params.get("company_id") || "").trim();
  const siteId = String(params.get("site_id") || "").trim();
  const month = monthStart(params.get("month"));
  if (!siteId) return { error: "Site is required." } as const;
  if (!month) return { error: "Valid month is required." } as const;
  return { companyId, siteId, month } as const;
}

export function validateEditablePeriod(period: any) {
  if (period.status === "submitted") return "Submitted attendance is read-only.";
  if (period.status === "level_1_approved" || period.status === "level_2_approved") return "Attendance pending approval is read-only.";
  if (period.status === "finalized") return "Finalized attendance is read-only.";
  if (period.status === "cancelled") return "Cancelled attendance period is read-only.";
  return null;
}

export function makePeriodSummary(employees: any[], rows: any[], month: string) {
  const dates = datesForMonth(month);
  const expected = employees.length * dates.length;
  return summarizeAttendance(rows.map((row) => row.status), expected);
}

export function validateDailyPayload(payload: any) {
  const attendance = Array.isArray(payload.attendance) ? payload.attendance : [];
  for (const row of attendance) {
    if (!row.employee_id) return "Employee is required for every attendance row.";
    if (!isAttendanceStatus(row.status)) return `Attendance status must be one of: ${ATTENDANCE_STATUSES.join(", ")}.`;
  }
  return null;
}

export function assertDateEditAllowed(auth: ServerPermissionContext, attendanceDate: string, reason?: string | null) {
  return canEditAttendanceDate(attendanceDate, isAdminRecoveryRole(auth.roleCodes), reason);
}

export function assertDateSelectable(auth: ServerPermissionContext, attendanceDate: string) {
  return canSelectAttendanceDate(attendanceDate, isAdminRecoveryRole(auth.roleCodes));
}

export function assertCanLockDate(attendanceDate: string) {
  if (!canLockAttendanceDate(attendanceDate)) {
    return "Attendance can be locked only after the attendance day has ended in Asia/Kolkata.";
  }
  return null;
}

export function assertCanFinalizeMonth(month: string) {
  if (!hasMonthEnded(month)) return "Attendance month cannot be finalized before the month has ended in Asia/Kolkata.";
  return null;
}

export function attendanceExportFilename(companyName: string, siteName: string, month: string) {
  const clean = `${companyName}-${siteName}-${month}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-");
  return `attendance-${clean}.csv`;
}

export { currentIndiaDate, datesForMonth, monthEnd, monthStart };
