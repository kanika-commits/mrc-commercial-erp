import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
  resolveWriteOrganizationId,
  type OrganizationScope,
} from "@/lib/serverOrganizationScope";
import { insertErpAuditLog, type ErpAuditAction } from "@/lib/serverAudit";
import { normalizeIdentifier, normalizeText } from "@/lib/labour/constants";
import { daysBefore, isAfterLabourDayEndLockCutoff, isAfterLabourPolicyLockCutoff, monthStart, todayInIst } from "@/lib/labour/operations";
import { optionalFormattedAadhaar } from "@/lib/utils/aadhaar";
import { hasActiveSiteHrAssignment } from "@/lib/serverSiteHr";

export const LABOUR_DOCUMENT_BUCKET = "labour-documents";

export function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function hasLabourPermission(access: Pick<LabourAccess, "auth">, moduleCode: string, actionCode: string) {
  return (access.auth.permissions || []).some((permission: any) =>
    permission.allowed === true &&
    ((permission.module_code === "*" && permission.action_code === "*") ||
      (permission.module_code === moduleCode && permission.action_code === actionCode)),
  );
}

export async function requireLabourPermission(request: Request, moduleCode: string, actionCode: string) {
  const auth = await requirePermission(request, moduleCode, actionCode);
  if ("response" in auth) return auth;
  const admin = adminClient();
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const assignments = await loadCompanySiteAssignments(admin, auth, organizationScope);
  return { auth, admin, organizationScope, assignments } satisfies LabourAccess;
}

export type LabourAccess = {
  auth: ServerPermissionContext;
  admin: any;
  organizationScope: OrganizationScope;
  assignments: { companyIds: string[] | null; siteIds: string[] | null };
};

export async function loadCompanySiteAssignments(
  admin: any,
  auth: Pick<ServerPermissionContext, "user" | "roleCodes">,
  organizationScope: OrganizationScope,
): Promise<{ companyIds: string[] | null; siteIds: string[] | null }> {
  if (organizationScope === null || auth.roleCodes.includes("super_admin")) {
    return { companyIds: null, siteIds: null };
  }

  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", auth.user.id);

  if (error) throw error;

  const companyIds: string[] = Array.from(
    new Set(
      (data || [])
        .map((row: any) => row.company_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const siteIds: string[] = Array.from(
    new Set(
      (data || [])
        .map((row: any) => row.site_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  return { companyIds, siteIds };
}

export function applyCompanySiteScope(query: any, assignments: { companyIds: string[] | null; siteIds: string[] | null }, companyColumn = "company_id", siteColumn = "site_id") {
  if (assignments.siteIds === null && assignments.companyIds === null) return query;
  if (assignments.siteIds?.length) return query.in(siteColumn, assignments.siteIds);
  if (assignments.companyIds?.length) return query.in(companyColumn, assignments.companyIds);
  return null;
}

export async function resolveOrganizationId(access: LabourAccess, requested?: string | null) {
  return resolveWriteOrganizationId(access.organizationScope, requested);
}

export async function validateCompanySite(access: LabourAccess, organizationId: string, companyId: string, siteId: string) {
  const { data: company, error: companyError } = await access.admin
    .from("companies")
    .select("id, organization_id, status")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) throw companyError;
  if (!company || company.organization_id !== organizationId || !isInOrganizationScope(access.organizationScope, company.organization_id)) {
    return { error: "Selected company is not available." };
  }

  const { data: site, error: siteError } = await access.admin
    .from("sites")
    .select("id, organization_id, company_id, status")
    .eq("id", siteId)
    .maybeSingle();
  if (siteError) throw siteError;
  if (!site || site.organization_id !== organizationId || site.company_id !== companyId) {
    return { error: "Selected site is not available for this company." };
  }

  if (access.assignments.companyIds && !access.assignments.companyIds.includes(companyId)) {
    return { error: "Selected company is outside your assigned scope." };
  }
  if (access.assignments.siteIds && !access.assignments.siteIds.includes(siteId)) {
    return { error: "Selected site is outside your assigned scope." };
  }

  return { company, site };
}

export async function validateLabourCompanySiteIndependent(access: LabourAccess, organizationId: string | null | undefined, companyId: string, siteId: string) {
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    access.admin
      .from("companies")
      .select("id, organization_id, status")
      .eq("id", companyId)
      .maybeSingle(),
    access.admin
      .from("sites")
      .select("id, organization_id, company_id, status")
      .eq("id", siteId)
      .maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  const resolvedOrganizationId = organizationId || company?.organization_id || null;
  if (!company || !resolvedOrganizationId || company.organization_id !== resolvedOrganizationId || !isInOrganizationScope(access.organizationScope, company.organization_id)) {
    return { error: "Selected company is not available." };
  }
  if (!site || site.organization_id !== resolvedOrganizationId || !isInOrganizationScope(access.organizationScope, site.organization_id)) {
    return { error: "Selected site is not available." };
  }

  if (access.assignments.companyIds && !access.assignments.companyIds.includes(companyId)) {
    return { error: "You do not have access to the selected company." };
  }
  if (access.assignments.siteIds && !access.assignments.siteIds.includes(siteId)) {
    return { error: "You do not have access to the selected site." };
  }

  return { company, site, organizationId: resolvedOrganizationId };
}

export type ResolvedLabourSitePair = {
  organization_id: string;
  company_id: string;
  site_id: string;
  company_name: string;
  company_code: string | null;
  site_name: string;
  site_code: string | null;
  attendance_system: "standard" | "site_in_engineer" | "unconfigured";
};

export type LabourSiteAttendancePolicySummary = {
  organization_id: string;
  site_id: string;
  attendance_system: "standard" | "site_in_engineer" | "unconfigured";
};

export async function loadResolvedLabourSitePairs(access: LabourAccess): Promise<{
  companies: any[];
  sites: any[];
  site_attendance_policies: LabourSiteAttendancePolicySummary[];
  company_site_pairs: ResolvedLabourSitePair[];
}> {
  const [companiesResult, sitesResult, policiesResult, accessPairsResult] = await Promise.all([
    applyOrganizationScope(
      access.admin
        .from("companies")
        .select("id, organization_id, company_name, company_code, status")
        .eq("status", "active")
        .order("company_name"),
      access.organizationScope,
    ) || Promise.resolve({ data: [], error: null }),
    applyOrganizationScope(
      access.admin
        .from("sites")
        .select("id, organization_id, site_name, site_code, status")
        .eq("status", "active")
        .order("site_name"),
      access.organizationScope,
    ) || Promise.resolve({ data: [], error: null }),
    applyOrganizationScope(
      access.admin
        .from("labour_site_attendance_policies")
        .select("organization_id, site_id, attendance_system, status")
        .is("company_id", null)
        .eq("status", "active")
        .is("effective_to", null),
      access.organizationScope,
    ) || Promise.resolve({ data: [], error: null }),
    access.assignments.companyIds === null && access.assignments.siteIds === null
      ? Promise.resolve({ data: [], error: null })
      : access.admin
        .from("user_access_assignments")
        .select("company_id, site_id")
        .eq("user_id", access.auth.user.id),
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (sitesResult.error) throw sitesResult.error;
  if (policiesResult.error && policiesResult.error.code !== "42703" && policiesResult.error.code !== "42P01") throw policiesResult.error;
  if (accessPairsResult.error) throw accessPairsResult.error;

  const accessPairs = accessPairsResult.data || [];
  const hasBroadAccess = access.assignments.companyIds === null && access.assignments.siteIds === null;
  const companyIds = new Set(accessPairs.map((pair: any) => pair.company_id).filter(Boolean));
  const siteIds = new Set(accessPairs.map((pair: any) => pair.site_id).filter(Boolean));
  const companies = (companiesResult.data || []).filter((company: any) => hasBroadAccess || !companyIds.size || companyIds.has(company.id));
  const sites = (sitesResult.data || []).filter((site: any) => hasBroadAccess || !siteIds.size || siteIds.has(site.id));
  const companyById = new Map(companies.map((company: any) => [company.id, company]));
  const siteById = new Map(sites.map((site: any) => [site.id, site]));
  const sitePolicies = new Map<string, LabourSiteAttendancePolicySummary>();
  if (!policiesResult.error) {
    for (const policy of policiesResult.data || []) {
      if (!siteById.has(policy.site_id)) continue;
      const configuredValue = normalizeText(policy.attendance_system);
      sitePolicies.set(policy.site_id, {
        organization_id: policy.organization_id,
        site_id: policy.site_id,
        attendance_system: configuredValue === "standard" || configuredValue === "site_in_engineer" ? configuredValue : "unconfigured",
      });
    }
  }
  const pairMap = new Map<string, ResolvedLabourSitePair>();
  for (const company of companies) {
    for (const site of sites) {
      if (company.organization_id !== site.organization_id) continue;
      const policy = sitePolicies.get(site.id);
      pairMap.set(`${company.id}:${site.id}`, {
        organization_id: company.organization_id,
        company_id: company.id,
        site_id: site.id,
        company_name: company.company_name,
        company_code: company.company_code || null,
        site_name: site.site_name,
        site_code: site.site_code || null,
        attendance_system: policy?.attendance_system || "unconfigured",
      });
    }
  }

  const sitesWithPolicy = sites.map((site: any) => {
    const policy = sitePolicies.get(site.id);
    return {
      ...site,
      site_id: site.id,
      attendance_system: policy?.attendance_system || "unconfigured",
    };
  });

  return {
    companies: companies.sort((a: any, b: any) => String(a?.company_name || "").localeCompare(String(b?.company_name || ""))),
    sites: sitesWithPolicy.sort((a: any, b: any) => String(a?.site_name || "").localeCompare(String(b?.site_name || ""))),
    site_attendance_policies: Array.from(sitePolicies.values()),
    company_site_pairs: Array.from(pairMap.values()).sort((a, b) =>
      `${a.company_name} ${a.site_name}`.localeCompare(`${b.company_name} ${b.site_name}`),
    ),
  };
}

export async function validateLabourOperationalCompanySite(
  access: LabourAccess,
  organizationId: string | null | undefined,
  companyId: string,
  siteId: string,
) {
  const pairs = await loadResolvedLabourSitePairs(access);
  const pair = pairs.company_site_pairs.find((item) =>
    item.company_id === companyId &&
    item.site_id === siteId &&
    (!organizationId || item.organization_id === organizationId),
  );
  if (!pair) return { error: "Selected company/site is outside your HR access scope." };
  const company = pairs.companies.find((item: any) => item.id === pair.company_id);
  const site = pairs.sites.find((item: any) => item.id === pair.site_id || item.site_id === pair.site_id);
  return {
    company,
    site,
    organizationId: pair.organization_id,
    attendanceSystem: pair.attendance_system,
    pair,
  };
}

export async function validateWorkOrder(access: LabourAccess, organizationId: string, companyId: string, siteId: string, workOrderId?: string | null) {
  const id = normalizeText(workOrderId);
  if (!id) return { workOrder: null };
  const { data, error } = await access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, status, approval_status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== organizationId || data.company_id !== companyId || data.site_id !== siteId || data.status !== "active") {
    return { error: "Selected Work Order is not available for this site." };
  }
  return { workOrder: data };
}

export async function validateLabourWorkOrderForContractor(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId: string;
  workOrderId?: string | null;
}) {
  const workOrderId = normalizeText(input.workOrderId);
  if (!workOrderId) return { error: "Labour Work Order is required." };
  const contractor = await loadScopedContractor(access, input.contractorProfileId);
  if (!contractor || contractor.organization_id !== input.organizationId || contractor.contractor_status !== "active") {
    return { error: "Selected labour contractor is not available." };
  }
  if (!contractor.vendor_id) return { error: "Selected labour contractor is not linked to a Vendor record." };
  const { data: workOrder, error: workOrderError } = await access.admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, wo_number, wo_type, status, approval_status")
    .eq("id", workOrderId)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  if (
    !workOrder ||
    workOrder.organization_id !== input.organizationId ||
    workOrder.company_id !== input.companyId ||
    workOrder.site_id !== input.siteId ||
    workOrder.status !== "active"
  ) {
    return { error: "Selected Labour Work Order is not available for this contractor and site." };
  }
  const { data: links, error: linkError } = await access.admin
    .from("work_order_vendors")
    .select("id")
    .eq("work_order_id", workOrderId)
    .eq("vendor_id", contractor.vendor_id)
    .limit(1);
  if (linkError) throw linkError;
  if (!(links || []).length) return { error: "Selected Labour Work Order is not linked to this contractor." };
  const commercialModel = workOrder.wo_type === "Daily Wage" ? "daily_wage" : "contract_basis";
  return { workOrder, contractor, commercialModel, requiresDailyRate: commercialModel === "daily_wage" };
}

export async function validateContractorProfile(access: LabourAccess, organizationId: string, contractorProfileId?: string | null) {
  const id = normalizeText(contractorProfileId);
  if (!id) return { contractor: null };
  const contractor = await loadScopedContractor(access, id);
  if (!contractor || contractor.organization_id !== organizationId || contractor.contractor_status !== "active") {
    return { error: "Selected labour contractor is not available." };
  }
  return { contractor };
}

export async function validateTrade(access: LabourAccess, organizationId: string, tradeId?: string | null) {
  const id = normalizeText(tradeId);
  if (!id) return { trade: null };
  const { data, error } = await access.admin
    .from("labour_trades")
    .select("id, organization_id, trade_name, trade_code, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== organizationId || data.status !== "active") {
    return { error: "Selected labour category is not available." };
  }
  return { trade: data };
}

export async function loadEligibleDeployments(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
  workOrderId?: string | null;
  manpowerWorkOrderId?: string | null;
  tradeId?: string | null;
  deploymentIds?: string[] | null;
  ignoreWorkerCreatedAt?: boolean;
  allowHistoricallyInactiveWorker?: boolean;
}) {
  let query = access.admin
    .from("labour_deployments")
    .select(`
      id, organization_id, labour_worker_id, contractor_profile_id, company_id, site_id,
      work_order_id, manpower_work_order_id, commercial_model, labour_trade_id, trade, skill_level, wage_type, wage_rate,
      effective_from, effective_to, status,
      labour_workers(id, labour_code, worker_name, father_or_husband_name, skill_level, status, worker_type, date_of_joining, date_of_exit, created_at),
      labour_contractor_profiles(id, contractor_code, vendors(vendor_name)),
      work_orders(id, wo_number),
      manpower_work_orders(id, manpower_wo_number, title, status, manpower_work_order_rates(id, labour_trade_id, daily_rate, effective_from, effective_to, status)),
      labour_trades(id, trade_name, trade_code)
    `)
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .in("status", ["active", "ended"])
    .order("effective_from", { ascending: false });

  if (input.deploymentIds) {
    if (!input.deploymentIds.length) return [];
    query = query.in("id", input.deploymentIds);
  } else {
    query = query
      .lte("effective_from", input.attendanceDate)
      .or(`effective_to.is.null,effective_to.gte.${input.attendanceDate}`);
  }

  if (input.contractorProfileId) query = query.eq("contractor_profile_id", input.contractorProfileId);
  if (input.workOrderId) query = query.eq("work_order_id", input.workOrderId);
  if (input.manpowerWorkOrderId) query = query.eq("manpower_work_order_id", input.manpowerWorkOrderId);
  if (input.tradeId) query = query.eq("labour_trade_id", input.tradeId);

  const scoped = applyCompanySiteScope(query, access.assignments);
  if (!scoped) return [];
  const { data, error } = await scoped;
  if (error) throw error;
  return (data || []).filter((deployment: any) => {
    const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
    if (!worker) return false;
    const historicalDate = input.allowHistoricallyInactiveWorker && input.attendanceDate < todayInIst();
    if (!historicalDate && worker.status !== "active") return false;
    if (!historicalDate && !input.ignoreWorkerCreatedAt && worker.created_at) {
      const registrationDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(worker.created_at));
      if (registrationDate > input.attendanceDate) return false;
    }
    if (worker.date_of_joining && worker.date_of_joining > input.attendanceDate) return false;
    if (worker.date_of_exit && worker.date_of_exit < input.attendanceDate) return false;
    return true;
  });
}

export async function loadFrozenAttendanceDeploymentIds(access: LabourAccess, period: any, attendanceDate: string, status: string) {
  if (!period || !["submitted", "approved", "finalized", "reopened"].includes(status)) return null;

  const { data: version, error: versionError } = await access.admin
    .from("labour_attendance_submission_versions")
    .select("id")
    .eq("period_id", period.id)
    .eq("attendance_date", attendanceDate)
    .eq("status", "submitted")
    .order("submission_version", { ascending: false })
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw versionError;

  if (version) {
    const { data: snapshotRows, error: snapshotError } = await access.admin
      .from("labour_attendance_submission_version_rows")
      .select("deployment_id")
      .eq("submission_version_id", version.id)
      .not("deployment_id", "is", null);
    if (snapshotError) throw snapshotError;
    return Array.from(new Set((snapshotRows || []).map((row: any) => row.deployment_id).filter(Boolean))) as string[];
  }

  const { data: attendanceRows, error: attendanceError } = await access.admin
    .from("labour_attendance")
    .select("deployment_id")
    .eq("period_id", period.id)
    .eq("attendance_date", attendanceDate)
    .not("deployment_id", "is", null);
  if (attendanceError) throw attendanceError;
  return Array.from(new Set((attendanceRows || []).map((row: any) => row.deployment_id).filter(Boolean))) as string[];
}

export async function loadAttendanceRowsForWorkers(access: LabourAccess, input: {
  periodId: string;
  organizationId: string;
  companyId: string;
  siteId: string;
  attendanceDate: string;
  workerIds?: string[];
}): Promise<any[]> {
  if (!input.workerIds?.length) return [];
  const { data, error } = await access.admin
    .from("labour_attendance")
    .select("*")
    .eq("period_id", input.periodId)
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("attendance_date", input.attendanceDate);
  if (error) throw error;
  const eligibleWorkerIds = new Set(input.workerIds);
  return (data || []).filter((row: any) => eligibleWorkerIds.has(row.labour_worker_id));
}

export async function findOrCreateAttendancePeriod(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate?: string | null;
  periodMonth?: string | null;
  originatingAttendanceSystem?: LabourAttendanceSystem | null;
}) {
  const periodMonth = monthStart(input.periodMonth || input.attendanceDate);
  if (!periodMonth) throw new Error("Valid month is required.");
  const { data: existingRows, error } = await access.admin
    .from("labour_attendance_periods")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("period_month", periodMonth)
    .is("contractor_profile_id", null)
    .order("contractor_profile_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const existing = existingRows?.[0] || null;
  if (existing) return existing;
  const { data, error: insertError } = await access.admin
    .from("labour_attendance_periods")
    .insert({
      organization_id: input.organizationId,
      company_id: input.companyId,
      site_id: input.siteId,
      contractor_profile_id: null,
      period_month: periodMonth,
      originating_attendance_system: input.originatingAttendanceSystem || "standard",
      status: "draft",
      ...actorFields(access.auth, "created"),
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data;
}

export async function getDayLock(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}) {
  const contractorId = normalizeText(input.contractorProfileId) || null;
  let query = access.admin
    .from("labour_attendance_day_locks")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("attendance_date", input.attendanceDate);
  query = contractorId ? query.eq("contractor_profile_id", contractorId) : query.is("contractor_profile_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveUnlockWindow(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}) {
  const contractorId = normalizeText(input.contractorProfileId) || null;
  let query = access.admin
    .from("labour_attendance_unlock_windows")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("attendance_date", input.attendanceDate)
    .eq("status", "open")
    .is("closed_at", null)
    .lte("opens_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString());
  query = contractorId ? query.eq("contractor_profile_id", contractorId) : query.is("contractor_profile_id", null);
  const { data, error } = await query.order("expires_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function getActiveHistoricalAttendanceAccess(access: LabourAccess, input: {
  organizationId: string;
  siteId: string;
  attendanceDate: string;
  attendanceType: "labour" | "employee";
}) {
  const now = new Date().toISOString();
  const { data, error } = await access.admin
    .from("attendance_historical_access")
    .select("id, attendance_type, from_date, to_date, reason, opened_by_name, opened_at, expires_at")
    .eq("organization_id", input.organizationId)
    .eq("site_id", input.siteId)
    .eq("attendance_type", input.attendanceType)
    .eq("status", "open")
    .is("closed_at", null)
    .lte("opens_at", now)
    .lte("from_date", input.attendanceDate)
    .gte("to_date", input.attendanceDate)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getActiveAttendancePolicy(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  const { data, error } = await access.admin
    .from("labour_site_attendance_policies")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .is("effective_to", null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getActiveSiteAttendanceSystemPolicy(access: LabourAccess, input: {
  organizationId: string;
  siteId: string;
}) {
  const { data, error } = await access.admin
    .from("labour_site_attendance_policies")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("site_id", input.siteId)
    .is("company_id", null)
    .eq("status", "active")
    .is("effective_to", null)
    .not("attendance_system", "is", null)
    .maybeSingle();
  if (error && error.code !== "42703" && error.code !== "42P01") throw error;
  return error ? null : data || null;
}

export async function getActiveMusterConfiguration(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  const { data, error } = await access.admin
    .from("labour_site_configurations")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("status", "active")
    .maybeSingle();
  if (error && error.code !== "42P01") throw error;
  return data || null;
}

export type LabourAttendanceSystem = "standard" | "site_in_engineer";

export function originatingAttendanceSystem(value: unknown): LabourAttendanceSystem | null {
  const next = normalizeText(value);
  return next === "standard" || next === "site_in_engineer" ? next : null;
}

export async function resolveSiteAttendanceSystem(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}): Promise<
  | { ok: true; attendanceSystem: LabourAttendanceSystem; configuration: any }
  | { ok: false; reason: "missing_configuration" | "missing_attendance_system" | "invalid_attendance_system"; message: string; configuration?: any }
> {
  const configuration = await getActiveSiteAttendanceSystemPolicy(access, {
    organizationId: input.organizationId,
    siteId: input.siteId,
  });
  if (!configuration) {
    return {
      ok: false,
      reason: "missing_configuration",
      message: "Attendance system is not configured for this site.",
    };
  }
  const attendanceSystem = normalizeText(configuration.attendance_system);
  if (!attendanceSystem) {
    return {
      ok: false,
      reason: "missing_attendance_system",
      message: "Attendance system is not configured for this site.",
      configuration,
    };
  }
  if (attendanceSystem !== "standard" && attendanceSystem !== "site_in_engineer") {
    return {
      ok: false,
      reason: "invalid_attendance_system",
      message: "Attendance system configuration is invalid for this site.",
      configuration,
    };
  }
  return { ok: true, attendanceSystem, configuration };
}

export function attendanceSystemLabel(value?: string | null) {
  if (value === "standard") return "Attendance System 1 — Standard Labour Attendance";
  if (value === "site_in_engineer") return "Attendance System 2 — Site-In & Engineer Workflow";
  return null;
}

export async function getActiveLabourOrganizationConfiguration(access: LabourAccess, input: {
  organizationId: string;
}) {
  const { data, error } = await access.admin
    .from("labour_organization_configurations")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (error && error.code !== "42P01") throw error;
  return data || null;
}

export async function isAssignedMusterPm(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  if (isGlobalOrSuperAdmin(access)) return true;
  const configuration = await getActiveMusterConfiguration(access, input);
  return configuration?.pm_user_id === access.auth.user.id;
}

export async function isAssignedLabourHoHr(access: LabourAccess, input: {
  organizationId: string;
}) {
  if (isGlobalOrSuperAdmin(access)) return true;
  const configuration = await getActiveLabourOrganizationConfiguration(access, input);
  return configuration?.ho_hr_user_id === access.auth.user.id;
}

export async function isAssignedMusterSiteHr(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  if (isGlobalOrSuperAdmin(access)) return true;
  return hasActiveSiteHrAssignment(access.admin, { ...input, userId: access.auth.user.id });
}

export async function loadMusterSiteHrBlocker(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  if (isGlobalOrSuperAdmin(access)) return null;
  const assigned = await isAssignedMusterSiteHr(access, input);
  const configuration = await getActiveMusterConfiguration(access, input);
  if (configuration?.site_hr_user_id && !assigned) {
    return "You are not assigned as Site HR for this Site.";
  }
  return null;
}

export async function hasAttendanceOverrideAuthority(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
}) {
  if (isGlobalOrSuperAdmin(access)) return true;
  if (!hasLabourPermission(access, "labour_attendance_policy", "override")) return false;
  const { data, error } = await access.admin
    .from("labour_site_override_authorities")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("user_id", access.auth.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error && error.code !== "42P01") throw error;
  return Boolean(data);
}

export async function loadLabourEditLockBlocker(access: LabourAccess, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}) {
  const contractorId = normalizeText(input.contractorProfileId) || null;
  if (contractorId) {
    const { data: submission, error: submissionError } = await access.admin
      .from("labour_daily_submissions")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("company_id", input.companyId)
      .eq("site_id", input.siteId)
      .eq("contractor_profile_id", contractorId)
      .eq("work_date", input.attendanceDate)
      .maybeSingle();
    if (submissionError && submissionError.code !== "42P01") throw submissionError;
    if (["pending_pm_approval", "pending_ho_approval"].includes(submission?.status)) {
      return "This Labour day has been submitted for approval.";
    }
    if (submission?.status === "final_approved") {
      return "This Labour day is finally approved.";
    }
  }

  const unlockWindow = await getActiveUnlockWindow(access, input);
  if (unlockWindow) return null;

  const dayLock = await getDayLock(access, input);
  if (dayLock?.is_locked) return "This attendance day is locked.";

  const configuration = await getActiveMusterConfiguration(access, input);
  if (configuration?.attendance_lock_hours && isAfterLabourDayEndLockCutoff({
    attendanceDate: input.attendanceDate,
    delayHours: configuration.attendance_lock_hours,
    timezone: "Asia/Kolkata",
  })) {
    return "Attendance is locked by the Muster Configuration lock rule.";
  }

  const policy = await getActiveAttendancePolicy(access, input);
  const basis = policy?.auto_lock_basis || (policy?.auto_lock_delay_hours !== null && policy?.auto_lock_delay_hours !== undefined ? "after_shift_end" : null);
  if (basis === "after_shift_end" && isAfterLabourPolicyLockCutoff({
    attendanceDate: input.attendanceDate,
    shiftEndTime: policy?.shift_end_time,
    delayHours: policy?.auto_lock_delay_hours,
    timezone: policy?.timezone || "Asia/Kolkata",
  })) {
    return "Attendance is locked by the automatic lock rule.";
  }

  return null;
}

export function isGlobalOrSuperAdmin(access: LabourAccess) {
  return access.organizationScope === null || access.auth.roleCodes.includes("super_admin");
}

export function actorCanEditAttendanceDate(
  access: LabourAccess,
  attendanceDate: string,
  reason?: string | null,
  options: { reopened?: boolean; historicallyOpened?: boolean } = {},
) {
  const today = todayInIst();
  if (attendanceDate > today) return { error: "Future labour attendance cannot be marked." };
  if (attendanceDate === today) return { ok: true };
  const oldestNormalEditDate = daysBefore(today, 2);
  const olderThanNormalWindow = attendanceDate < oldestNormalEditDate;
  if (!isGlobalOrSuperAdmin(access) && olderThanNormalWindow && !options.reopened && !options.historicallyOpened) {
    return { error: "Labour attendance can be edited only for today, yesterday or the day before yesterday." };
  }
  if (!olderThanNormalWindow) return { ok: true };
  if (!options.historicallyOpened && !normalizeText(reason)) return { error: "Backdated attendance reason is required." };
  return { ok: true };
}

export async function loadScopedWorker(access: LabourAccess, workerId: string) {
  let query = access.admin
    .from("labour_workers")
    .select("*, labour_trades:labour_trade_id(id, trade_name, trade_code)")
    .eq("id", workerId)
    .neq("status", "deleted");
  const scoped = applyOrganizationScope(query, access.organizationScope);
  if (!scoped) return null;
  query = scoped;
  if (access.assignments.siteIds?.length && !access.assignments.companyIds?.length) {
    query = query.in("current_site_id", access.assignments.siteIds);
  } else if (access.assignments.companyIds?.length) {
    query = query.or(`current_company_id.in.(${access.assignments.companyIds.join(",")}),current_company_id.is.null`);
  } else if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) {
    return null;
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadScopedContractor(access: LabourAccess, contractorId: string) {
  let query = access.admin.from("labour_contractor_profiles").select("*, vendors(id, vendor_name, pan, gstin, organization_id)").eq("id", contractorId);
  const scoped = applyOrganizationScope(query, access.organizationScope);
  if (!scoped) return null;
  const { data, error } = await scoped.maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadScopedLabourImportBatch(access: LabourAccess, batchId: string) {
  const { data, error } = await access.admin
    .from("labour_import_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (access.organizationScope !== null && !access.organizationScope.includes(data.organization_id)) return null;
  if (access.assignments.companyIds?.length && data.selected_company_id && !access.assignments.companyIds.includes(data.selected_company_id)) return null;
  if (access.assignments.siteIds?.length && data.selected_site_id && !access.assignments.siteIds.includes(data.selected_site_id)) return null;
  if (access.assignments.companyIds && access.assignments.siteIds && !access.assignments.companyIds.length && !access.assignments.siteIds.length) return null;
  return data;
}

export async function assertSameOrgVendor(access: LabourAccess, organizationId: string, vendorId: string) {
  const { data, error } = await access.admin
    .from("vendors")
    .select("id, organization_id, vendor_name, pan, gstin, status")
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== organizationId || !isInOrganizationScope(access.organizationScope, data.organization_id)) {
    return { error: "Selected vendor is not available for this organization." };
  }
  return { vendor: data };
}

export async function audit(access: LabourAccess, request: Request, input: {
  moduleCode: string;
  action: ErpAuditAction;
  entityType: string;
  recordId?: string | null;
  parentEntityType?: string | null;
  parentRecordId?: string | null;
  organizationId?: string | null;
  companyId?: string | null;
  siteId?: string | null;
  description?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  importBatchId?: string | null;
}) {
  await insertErpAuditLog(access.admin, access.auth.user, input, request);
}

export function actorFields(auth: ServerPermissionContext, prefix: "created" | "updated" | "uploaded" = "created") {
  const name = auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email || "Unknown User";
  return {
    [`${prefix}_by`]: auth.user.id,
    [`${prefix}_by_name`]: name,
    [`${prefix}_by_email`]: auth.user.email || null,
  };
}

export function normalizeLabourIdentity(input: Record<string, any>) {
  const aadhaar = optionalFormattedAadhaar(input.aadhaar_number);
  return {
    aadhaar_number: aadhaar.error ? normalizeIdentifier(input.aadhaar_number) : aadhaar.formatted,
    uan_number: normalizeIdentifier(input.uan_number),
    esi_number: normalizeIdentifier(input.esi_number),
  };
}
