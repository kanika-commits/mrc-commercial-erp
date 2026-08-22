import { NextResponse } from "next/server";
import {
  actorFields,
  actorCanEditAttendanceDate,
  audit,
  findOrCreateAttendancePeriod,
  getActiveAttendancePolicy,
  getDayLock,
  jsonError,
  loadLabourEditLockBlocker,
  loadMusterSiteHrBlocker,
  isGlobalOrSuperAdmin,
  loadEligibleDeployments,
  loadFrozenAttendanceDeploymentIds,
  requireLabourPermission,
  originatingAttendanceSystem,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateTrade,
  validateWorkOrder,
} from "@/app/api/labour/_shared";
import { buildLabourAttendanceUpsertPayload, daysBefore, isoDate, todayInIst } from "@/lib/labour/operations";
import { labelFromCode, normalizeText } from "@/lib/labour/constants";
import { hasActiveSiteHrAssignment } from "@/lib/serverSiteHr";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

const MAX_STANDARD_OT_MINUTES = 360;

function nullableShiftStatus(value: unknown) {
  const next = text(value);
  if (!next || next === "not_marked") return null;
  return next === "present" || next === "absent" ? next : "__invalid__";
}

function optionalWholeOtHours(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const textValue = String(value).trim();
  if (!/^\d+$/.test(textValue)) return null;
  const hours = Number(textValue);
  return Number.isSafeInteger(hours) && hours >= 0 ? hours : null;
}

function optionalWholeBonusHours(value: unknown) {
  if (value === null || value === undefined || value === "") return { ok: true, minutes: null };
  const textValue = String(value).trim();
  if (!/^\d+$/.test(textValue)) return { ok: false, minutes: null };
  const hours = Number(textValue);
  if (!Number.isSafeInteger(hours) || hours < 0) return { ok: false, minutes: null };
  return { ok: true, minutes: Math.round(hours * 60) };
}

function hasServerPermission(access: any, moduleCode: string, actionCode: string) {
  return (access.auth.permissions || []).some(
    (permission: any) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode && permission.action_code === actionCode)),
  );
}

function moneyLabel(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not Set";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function publicSupportingPdf(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    file_name: row.original_file_name,
    mime_type: row.mime_type,
    file_size: row.size_bytes,
    uploaded_at: row.uploaded_at,
    uploaded_by_name: row.uploaded_by_name,
    uploaded_by_email: row.uploaded_by_email,
  };
}

function activeMwoRate(deployment: any, attendanceDate: string) {
  const mwo = Array.isArray(deployment.manpower_work_orders) ? deployment.manpower_work_orders[0] : deployment.manpower_work_orders;
  const rates = mwo?.manpower_work_order_rates || [];
  return rates.find((rate: any) =>
    rate.status === "active" &&
    rate.labour_trade_id === deployment.labour_trade_id &&
    rate.effective_from <= attendanceDate &&
    (!rate.effective_to || rate.effective_to >= attendanceDate)
  ) || null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function rateApplies(rate: any, attendanceDate: string) {
  if (!rate || rate.status === "cancelled") return false;
  if (rate.effective_from && rate.effective_from > attendanceDate) return false;
  if (rate.effective_to && rate.effective_to < attendanceDate) return false;
  return true;
}

function dailyWageRate(deployment: any, mwoRate: any, workerRates: any[], attendanceDate: string) {
  const workerRate = workerRates.find((rate: any) => {
    const tradeMatches = !deployment.labour_trade_id || !rate.trade_id || rate.trade_id === deployment.labour_trade_id;
    return tradeMatches && rate.wage_type === "daily" && rateApplies(rate, attendanceDate);
  });
  return numberOrNull(workerRate?.base_rate)
    ?? numberOrNull(mwoRate?.daily_rate)
    ?? numberOrNull(deployment.wage_rate);
}

function timePlusHours(value?: string | null, hours = 0) {
  const textValue = String(value || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(textValue)) return null;
  const [hour, minute] = textValue.split(":").map(Number);
  const total = (hour * 60 + minute + hours * 60) % (24 * 60);
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}:00`;
}

function booleanToShiftStatus(value: unknown) {
  if (value === true) return "present";
  if (value === false) return "absent";
  return null;
}

function shiftStatusToBoolean(value: "present" | "absent" | null) {
  if (value === "present") return true;
  if (value === "absent") return false;
  return null;
}

function summaryStatus(first: "present" | "absent" | null, second: "present" | "absent" | null) {
  if (first === null && second === null) return "not_deployed";
  if (first === "present" && second === "present") return "present";
  if (first === "absent" && second === "absent") return "absent";
  return "half_day";
}

function selectedDateRegisterStatus(period: any, attendanceRows: any[], attendanceDate: string) {
  if (!period) return "draft";
  const dateStatus = period.summary?.date_statuses?.[attendanceDate]?.status;
  if (dateStatus) return dateStatus;
  return "draft";
}

function selectedDateReadOnlyReason(period: any, dayLock: any, selectedStatus: string) {
  if (dayLock?.is_locked) return "Attendance is locked for this date.";
  if (selectedStatus === "reopened") return null;
  if (selectedStatus === "submitted") return "Attendance has been submitted for this date.";
  if (selectedStatus === "finalized") return "Attendance has been approved for this date.";
  return null;
}

function workerOtLabel(deployment: any) {
  const worker = Array.isArray(deployment?.labour_workers) ? deployment.labour_workers[0] : deployment?.labour_workers;
  return worker?.labour_code || worker?.worker_name || "selected labourer";
}

const UNKNOWN_ORIGIN_MESSAGE = "This attendance period has no originating attendance workflow. Confirm the historical workflow before editing it.";

async function loadExistingAttendancePeriod(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}) {
  const periodMonth = `${input.attendanceDate.slice(0, 7)}-01`;
  const { data, error } = await access.admin
    .from("labour_attendance_periods")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("period_month", periodMonth)
    .order("contractor_profile_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function hasRows(query: any) {
  const { count, error } = await query;
  if (error) throw error;
  return Number(count || 0) > 0;
}

async function isAbandonedEmptyAttendancePeriod(access: any, input: {
  period: any;
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}) {
  if (!input.period || input.period.status !== "draft") return false;
  if (originatingAttendanceSystem(input.period.originating_attendance_system)) return false;
  if (input.period.submitted_at || input.period.finalized_at || input.period.submitted_by || input.period.finalized_by) return false;

  const [hasAttendance, hasSiteIn, hasSubmission, dayLock] = await Promise.all([
    hasRows(access.admin.from("labour_attendance").select("id", { count: "exact", head: true }).eq("period_id", input.period.id)),
    hasRows(
      access.admin
        .from("labour_site_ins")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", input.organizationId)
        .eq("company_id", input.companyId)
        .eq("site_id", input.siteId)
        .eq("site_in_date", input.attendanceDate),
    ),
    hasRows(
      access.admin
        .from("labour_daily_submissions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", input.organizationId)
        .eq("company_id", input.companyId)
        .eq("site_id", input.siteId)
        .eq("work_date", input.attendanceDate),
    ),
    getDayLock(access, {
      organizationId: input.organizationId,
      companyId: input.companyId,
      siteId: input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate: input.attendanceDate,
    }),
  ]);

  return !hasAttendance && !hasSiteIn && !hasSubmission && !dayLock?.is_locked;
}

async function resolveAttendanceSystemForPeriod(access: any, input: {
  period: any | null;
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
}): Promise<
  | { attendanceSystem: "standard" | "site_in_engineer"; period: any | null }
  | { error: string; status: number }
> {
  const existingOrigin = originatingAttendanceSystem(input.period?.originating_attendance_system);
  if (existingOrigin) return { attendanceSystem: existingOrigin, period: input.period };

  if (input.period) {
    const abandoned = await isAbandonedEmptyAttendancePeriod(access, {
      period: input.period,
      organizationId: input.organizationId,
      companyId: input.companyId,
      siteId: input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate: input.attendanceDate,
    });
    if (!abandoned) return { error: UNKNOWN_ORIGIN_MESSAGE, status: 409 };
  }

  const system = await resolveSiteAttendanceSystem(access, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
  });
  if (!system.ok) return { error: system.message, status: 403 };
  if (!input.period) return { attendanceSystem: system.attendanceSystem, period: null };

  const { data: updated, error: updateError } = await access.admin
    .from("labour_attendance_periods")
    .update({
      originating_attendance_system: system.attendanceSystem,
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    })
    .eq("id", input.period.id)
    .is("originating_attendance_system", null)
    .eq("status", "draft")
    .is("submitted_at", null)
    .is("finalized_at", null)
    .select("*")
    .maybeSingle();
  if (updateError) throw updateError;
  if (updated) return { attendanceSystem: system.attendanceSystem, period: updated };

  const reloaded = await loadExistingAttendancePeriod(access, input);
  const finalOrigin = originatingAttendanceSystem(reloaded?.originating_attendance_system);
  if (!finalOrigin) return { error: UNKNOWN_ORIGIN_MESSAGE, status: 409 };
  return { attendanceSystem: finalOrigin, period: reloaded };
}

function deploymentWorker(deployment: any) {
  return Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
}

async function loadSiteInPopulation(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileIds?: string[] | null;
  attendanceDate: string;
}) {
  if (input.contractorProfileIds && !input.contractorProfileIds.length) return { siteIns: [], deployments: [] };
  let siteInQuery = access.admin
    .from("labour_site_ins")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("site_in_date", input.attendanceDate)
    .eq("status", "active")
    .order("site_in_time", { ascending: true });
  if (input.contractorProfileIds?.length) siteInQuery = siteInQuery.in("contractor_profile_id", input.contractorProfileIds);
  const { data: siteIns, error: siteInError } = await siteInQuery;
  if (siteInError) throw siteInError;
  const deploymentIds = Array.from(new Set((siteIns || []).map((row: any) => row.deployment_id).filter(Boolean)));
  if (!deploymentIds.length) return { siteIns: [], deployments: [] };
  const { data: deployments, error: deploymentError } = await access.admin
    .from("labour_deployments")
    .select(`
      id, organization_id, labour_worker_id, contractor_profile_id, company_id, site_id,
      work_order_id, manpower_work_order_id, commercial_model, labour_trade_id, trade, skill_level, wage_type, wage_rate,
      effective_from, effective_to, status,
      labour_workers(id, labour_code, worker_name, father_or_husband_name, skill_level, status, worker_type, date_of_joining, date_of_exit),
      labour_contractor_profiles(id, contractor_code, contractor_status, vendors(vendor_name)),
      work_orders(id, wo_number),
      manpower_work_orders(id, manpower_wo_number, title, status, manpower_work_order_rates(id, labour_trade_id, daily_rate, effective_from, effective_to, status)),
      labour_trades(id, trade_name, trade_code, status)
    `)
    .in("id", deploymentIds);
  if (deploymentError) throw deploymentError;
  const deploymentById = new Map((deployments || []).map((deployment: any) => [deployment.id, deployment]));
  return {
    siteIns: (siteIns || []).filter((siteIn: any) => {
      const deployment = deploymentById.get(siteIn.deployment_id);
      const worker = deployment ? deploymentWorker(deployment) : null;
      return Boolean(deployment && worker && worker.status === "active");
    }),
    deployments: deployments || [],
  };
}

async function loadContractorProfileIds(access: any, organizationId: string, contractorProfileId?: string | null) {
  const id = text(contractorProfileId);
  if (!id) return { profileIds: null, primaryProfileId: null };
  const { data: profile, error: profileError } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, organization_id, contractor_status")
    .eq("id", id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.organization_id !== organizationId || profile.contractor_status !== "active") {
    return { error: "Selected contractor is not available." };
  }
  return { profileIds: [id], primaryProfileId: id };
}

async function loadStandardPopulation(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  contractorProfileId?: string | null;
  attendanceDate: string;
  deploymentIds?: string[] | null;
  ignoreWorkerCreatedAt?: boolean;
}) {
  const deployments = await loadEligibleDeployments(access, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    siteId: input.siteId,
    contractorProfileId: input.contractorProfileId || null,
    attendanceDate: input.attendanceDate,
    deploymentIds: input.deploymentIds,
    ignoreWorkerCreatedAt: input.ignoreWorkerCreatedAt,
  });
  return { deployments };
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance", "view");
    if ("response" in access) return access.response;
    const { searchParams } = new URL(request.url);
    const requestedOrganizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    const attendanceDateRaw = searchParams.get("attendance_date");
    const attendanceDate = isoDate(attendanceDateRaw);
    const contractorProfileFilterId = text(searchParams.get("contractor_profile_id") || searchParams.get("contractor_vendor_id"));
    const workOrderId = text(searchParams.get("work_order_id"));
    const tradeId = text(searchParams.get("trade_id"));
    if (!companyId) return jsonError("Company is required.");
    if (!siteId) return jsonError("Site is required.");
    if (!attendanceDateRaw) return jsonError("Attendance date is required.");
    if (!attendanceDate) return jsonError("Attendance date must be in YYYY-MM-DD format.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const siteHrBlocker = await loadMusterSiteHrBlocker(access, { organizationId, companyId, siteId });
    if (siteHrBlocker) return jsonError(siteHrBlocker, 403);
    const contractorCheck = await loadContractorProfileIds(access, organizationId, contractorProfileFilterId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const contractorProfileId = contractorCheck.primaryProfileId;
    const contractorProfileIds = contractorCheck.profileIds;
    const existingPeriod = await loadExistingAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    const originResult = await resolveAttendanceSystemForPeriod(access, { period: existingPeriod, organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    if ("error" in originResult) return jsonError(originResult.error, originResult.status);
    const attendanceSystem = originResult.attendanceSystem;
    if (attendanceSystem === "site_in_engineer") {
      return jsonError("This attendance period belongs to Site-In & Engineer Daily Labour. Use Engineer Daily Labour for this existing record.", 403);
    }
    const workOrderCheck = await validateWorkOrder(access, organizationId, companyId, siteId, workOrderId);
    if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Selected Work Order is not available.", 403);
    const tradeCheck = await validateTrade(access, organizationId, tradeId);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected labour category is not available.", 403);

    const period = await findOrCreateAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate, originatingAttendanceSystem: "standard" });
    const dateStatusForPopulation = selectedDateRegisterStatus(period, [], attendanceDate);
    const frozenDeploymentIds = await loadFrozenAttendanceDeploymentIds(access, period, attendanceDate, dateStatusForPopulation);
    const [population, dayLock, policy] = await Promise.all([
      loadStandardPopulation(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate, deploymentIds: frozenDeploymentIds, ignoreWorkerCreatedAt: !frozenDeploymentIds }),
      getDayLock(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate }),
      getActiveAttendancePolicy(access, { organizationId, companyId, siteId }),
    ]);

    let deployments = population.deployments || [];
    if (workOrderId) deployments = deployments.filter((deployment: any) => deployment.work_order_id === workOrderId);
    if (tradeId) deployments = deployments.filter((deployment: any) => deployment.labour_trade_id === tradeId);
    const workerIds = deployments.map((row: any) => row.labour_worker_id);
    const { data: attendanceRows, error: attendanceError } = workerIds.length
      ? await access.admin.from("labour_attendance").select("*").eq("attendance_date", attendanceDate).in("labour_worker_id", workerIds)
      : { data: [], error: null };
    if (attendanceError) throw attendanceError;
    const selectedStatus = selectedDateRegisterStatus(period, attendanceRows || [], attendanceDate);
    const attendanceByWorker = new Map((attendanceRows || []).map((row: any) => [row.labour_worker_id, row]));
    const { data: workerRates, error: workerRatesError } = workerIds.length
      ? await access.admin
          .from("labour_wage_rates")
          .select("labour_worker_id, trade_id, wage_type, base_rate, effective_from, effective_to, status")
          .in("labour_worker_id", workerIds)
          .neq("status", "cancelled")
          .lte("effective_from", attendanceDate)
          .or(`effective_to.is.null,effective_to.gte.${attendanceDate}`)
          .order("effective_from", { ascending: false })
      : { data: [], error: null };
    if (workerRatesError) throw workerRatesError;
    const workerRatesByWorker = new Map<string, any[]>();
    for (const rate of workerRates || []) {
      const rates = workerRatesByWorker.get(rate.labour_worker_id) || [];
      rates.push(rate);
      workerRatesByWorker.set(rate.labour_worker_id, rates);
    }

    const rows = deployments.map((deployment: any) => {
      const saved = attendanceByWorker.get(deployment.labour_worker_id);
      const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
      const workOrder = Array.isArray(deployment.work_orders) ? deployment.work_orders[0] : deployment.work_orders;
      const manpowerWorkOrder = Array.isArray(deployment.manpower_work_orders) ? deployment.manpower_work_orders[0] : deployment.manpower_work_orders;
      const mwoRate = activeMwoRate(deployment, attendanceDate);
      const paymentModel = deployment.commercial_model === "daily_wage" ? "daily_wage" : "contract_basis";
      const rateApplicable = paymentModel === "daily_wage";
      const dailyRate = rateApplicable ? dailyWageRate(deployment, mwoRate, workerRatesByWorker.get(deployment.labour_worker_id) || [], attendanceDate) : null;
      const assignmentNumber = rateApplicable ? manpowerWorkOrder?.manpower_wo_number : workOrder?.wo_number;
      const firstShiftStatus = booleanToShiftStatus(saved?.first_half_present);
      const secondShiftStatus = booleanToShiftStatus(saved?.second_half_present);
      return {
        site_in_id: null,
        site_in_time: null,
        first_shift_completes_at: null,
        second_shift_completes_at: null,
        ot_starts_after: null,
        deployment_id: deployment.id,
        labour_worker_id: deployment.labour_worker_id,
        worker,
        contractor: deployment.labour_contractor_profiles,
        work_order: workOrder || null,
        manpower_work_order: manpowerWorkOrder || null,
        manpower_work_order_id: deployment.manpower_work_order_id || null,
        assignment_number: assignmentNumber || null,
        assignment_label: rateApplicable
          ? [manpowerWorkOrder?.manpower_wo_number, manpowerWorkOrder?.title].filter(Boolean).join(" · ")
          : workOrder?.wo_number || null,
        commercial_model: paymentModel,
        payment_model: paymentModel,
        payment_model_label: labelFromCode(paymentModel),
        trade: deployment.labour_trades || { trade_name: deployment.trade },
        skill_level: deployment.skill_level || worker?.skill_level,
        daily_rate: dailyRate,
        rate_applicable: rateApplicable,
        daily_rate_label: rateApplicable ? moneyLabel(dailyRate) : "N/A",
        attendance: saved || null,
        status: saved?.status || summaryStatus(firstShiftStatus, secondShiftStatus),
        first_shift_status: firstShiftStatus,
        second_shift_status: secondShiftStatus,
        first_half_present: saved?.first_half_present ?? null,
        second_half_present: saved?.second_half_present ?? null,
        overtime_minutes: saved?.overtime_minutes || 0,
        ot_hours: Number(saved?.overtime_minutes || 0) > 0 ? Math.round(Number(saved?.overtime_minutes || 0) / 60) : "",
        bonus_minutes: saved?.bonus_minutes ?? null,
        bonus_hours: saved?.bonus_minutes === null || saved?.bonus_minutes === undefined ? "" : String(Math.round(Number(saved.bonus_minutes || 0) / 60)),
        proposed_overtime_minutes: saved?.proposed_overtime_minutes || saved?.overtime_minutes || 0,
        approved_overtime_minutes: saved?.approved_overtime_minutes ?? null,
        remarks: saved?.remarks || "",
      };
    });
    const { data: supportingPdf, error: supportingPdfError } = period
      ? await access.admin
          .from("labour_attendance_date_documents")
          .select("id, original_file_name, mime_type, size_bytes, uploaded_at, uploaded_by_name, uploaded_by_email")
          .eq("period_id", period.id)
          .eq("attendance_date", attendanceDate)
          .eq("is_active", true)
          .order("uploaded_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };
    if (supportingPdfError) throw supportingPdfError;

    return NextResponse.json({
      rows,
      period: period ? { ...period, status: selectedStatus, period_status: period.status } : period,
      supporting_pdf: publicSupportingPdf(supportingPdf),
      day_lock: dayLock,
      policy: policy ? {
        shift_start_time: policy.shift_start_time,
        shift_end_time: policy.shift_end_time,
        max_daily_ot_minutes: policy.max_daily_ot_minutes,
      } : null,
      attendance_system: "standard",
      read_only: Boolean(selectedDateReadOnlyReason(period, dayLock, selectedStatus)),
      read_only_reason: selectedDateReadOnlyReason(period, dayLock, selectedStatus),
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour attendance.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_attendance", "view");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const submitMode = payload.mode === "submit";
    if (submitMode && !hasServerPermission(access, "labour_attendance", "submit")) {
      return jsonError("You do not have permission to submit labour attendance.", 403);
    }
    const requestedOrganizationId = text(payload.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const companyId = text(payload.company_id);
    const siteId = text(payload.site_id);
    const attendanceDate = isoDate(payload.attendance_date);
    const contractorProfileFilterId = text(payload.contractor_profile_id || payload.contractor_vendor_id);
    const backdatedReason = text(payload.backdated_reason);
    if (!companyId || !siteId || !attendanceDate) return jsonError("Company, site and attendance date are required.");

    const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const organizationId = scopeCheck.organizationId;
    const siteHrBlocker = await loadMusterSiteHrBlocker(access, { organizationId, companyId, siteId });
    if (siteHrBlocker) return jsonError(siteHrBlocker, 403);
    if (!isGlobalOrSuperAdmin(access) && !(await hasActiveSiteHrAssignment(access.admin, { organizationId, companyId, siteId, userId: access.auth.user.id }))) {
      return jsonError("You are not assigned as Site HR for this site.", 403);
    }
    const contractorCheck = await loadContractorProfileIds(access, organizationId, contractorProfileFilterId);
    if ("error" in contractorCheck) return jsonError(contractorCheck.error || "Selected contractor is not available.", 403);
    const contractorProfileId = contractorCheck.primaryProfileId;
    const contractorProfileIds = contractorCheck.profileIds;

    const existingPeriod = await loadExistingAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    const reopenedDate = existingPeriod?.summary?.date_statuses?.[attendanceDate]?.status === "reopened";
    const dateAccess = actorCanEditAttendanceDate(access, attendanceDate, backdatedReason, { reopened: reopenedDate });
    if ("error" in dateAccess) return jsonError(dateAccess.error || "You cannot edit attendance for this date.", 403);
    const originResult = await resolveAttendanceSystemForPeriod(access, { period: existingPeriod, organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    if ("error" in originResult) return jsonError(originResult.error, originResult.status);
    const attendanceSystem = originResult.attendanceSystem;
    if (attendanceSystem === "site_in_engineer") {
      return jsonError("This attendance period belongs to Site-In & Engineer Daily Labour. Use Engineer Daily Labour for this existing record.", 403);
    }
    const period = originResult.period || await findOrCreateAttendancePeriod(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate, originatingAttendanceSystem: "standard" });
    const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId, companyId, siteId, contractorProfileId, attendanceDate });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    const policy = await getActiveAttendancePolicy(access, { organizationId, companyId, siteId });
    const canOverrideAbsentToPresent = hasServerPermission(access, "labour_attendance", "override");

    const changes = Array.isArray(payload.rows) ? payload.rows : [];
    if (!changes.length) return NextResponse.json({ saved: 0 });
    const populationStatus = selectedDateRegisterStatus(period, [], attendanceDate);
    const frozenDeploymentIds = await loadFrozenAttendanceDeploymentIds(access, period, attendanceDate, populationStatus);
    const population = await loadStandardPopulation(access, {
      organizationId,
      companyId,
      siteId,
      contractorProfileId,
      attendanceDate,
      deploymentIds: frozenDeploymentIds,
      ignoreWorkerCreatedAt: !frozenDeploymentIds,
    });
    const deploymentByWorker = new Map((population.deployments || []).map((deployment: any) => [deployment.labour_worker_id, deployment]));
    const workerIds = changes.map((change: any) => text(change.labour_worker_id)).filter(Boolean) as string[];
    const { data: existingRows, error: existingError } = workerIds.length
      ? await access.admin
          .from("labour_attendance")
          .select("*")
          .eq("attendance_date", attendanceDate)
          .in("labour_worker_id", workerIds)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const selectedStatus = selectedDateRegisterStatus(period, existingRows || [], attendanceDate);
    if (["submitted", "finalized"].includes(selectedStatus)) return jsonError("Attendance is locked for editing for this date.", 403);
    const requiresOverride = selectedStatus !== "draft";
    const { data: wagePeriod, error: wageError } = await access.admin
      .from("labour_wage_periods")
      .select("id, status")
      .eq("attendance_period_id", period.id)
      .maybeSingle();
    if (wageError) throw wageError;
    if (wagePeriod?.status === "finalized" && (existingRows || []).length > 0) return jsonError("Reopen the finalized wage period before changing attendance.", 403);
    const existingByWorker = new Map((existingRows || []).map((row: any) => [row.labour_worker_id, row]));

    const now = new Date().toISOString();
    const rows = [];
    const overrideAudits: Array<{
      workerId: string;
      shift: "first_shift" | "second_shift";
      previous: string;
      next: string;
      reason: string;
      attendanceId?: string | null;
    }> = [];
    for (const change of changes) {
      const workerId = text(change.labour_worker_id);
      const deployment: any = workerId ? deploymentByWorker.get(workerId) : null;
      if (!workerId || !deployment) return jsonError("One or more labourers are not actively deployed for the selected Site/date.", 403);
      const existing = existingByWorker.get(workerId);
      const requiredAction = existing ? "edit" : "add";
      if (!hasServerPermission(access, "labour_attendance", requiredAction)) {
        return jsonError(existing ? "You do not have permission to edit labour attendance." : "You do not have permission to add labour attendance.", 403);
      }
      const firstShiftStatus = nullableShiftStatus(change.first_shift_status);
      const secondShiftStatus = nullableShiftStatus(change.second_shift_status);
      if (firstShiftStatus === "__invalid__" || secondShiftStatus === "__invalid__") return jsonError("Invalid shift attendance status.");
      if (payload.mode === "submit" && (!firstShiftStatus || !secondShiftStatus)) {
        return jsonError("Mark First Shift and Second Shift for every loaded Site-In labourer before submitting.");
      }
      const firstHalfPresent = shiftStatusToBoolean(firstShiftStatus as "present" | "absent" | null);
      const secondHalfPresent = shiftStatusToBoolean(secondShiftStatus as "present" | "absent" | null);
      const firstOverrideReason = text(change.first_shift_override_reason || change.override_reason);
      const secondOverrideReason = text(change.second_shift_override_reason || change.override_reason);
      if (requiresOverride && existing?.first_half_present === false && firstHalfPresent === true) {
        if (!canOverrideAbsentToPresent) return jsonError("You do not have permission to change First Shift from Absent to Present.", 403);
        if (!firstOverrideReason || firstOverrideReason.length < 10) return jsonError("Enter an override reason of at least 10 characters for First Shift.");
        overrideAudits.push({ workerId, shift: "first_shift", previous: "absent", next: "present", reason: firstOverrideReason, attendanceId: existing?.id });
      }
      if (requiresOverride && existing?.second_half_present === false && secondHalfPresent === true) {
        if (!canOverrideAbsentToPresent) return jsonError("You do not have permission to change Second Shift from Absent to Present.", 403);
        if (!secondOverrideReason || secondOverrideReason.length < 10) return jsonError("Enter an override reason of at least 10 characters for Second Shift.");
        overrideAudits.push({ workerId, shift: "second_shift", previous: "absent", next: "present", reason: secondOverrideReason, attendanceId: existing?.id });
      }
      const otHours = optionalWholeOtHours(change.ot_hours ?? (change.overtime_minutes === undefined ? "" : Number(change.overtime_minutes) / 60));
      if (otHours === null) return jsonError("OT Hours must be a whole number from 0 to 6, or leave it blank for no OT.");
      const overtime = Math.max(0, Math.round(otHours * 60));
      if (overtime > MAX_STANDARD_OT_MINUTES) {
        return jsonError(`OT Hours cannot exceed 6 hours for ${workerOtLabel(deployment)}.`);
      }
      const bonus = optionalWholeBonusHours(change.bonus_hours ?? (change.bonus_minutes === undefined ? "" : Number(change.bonus_minutes) / 60));
      if (!bonus.ok) return jsonError("Bonus Hours must be blank or a non-negative whole number.");
      const maxDailyOt = policy?.max_daily_ot_minutes === null || policy?.max_daily_ot_minutes === undefined
        ? null
        : Math.max(0, Math.round(Number(policy.max_daily_ot_minutes)));
      if (maxDailyOt !== null && overtime > maxDailyOt) {
        return jsonError("Overtime exceeds the maximum allowed by the Attendance Policy.");
      }
      rows.push(buildLabourAttendanceUpsertPayload({
        existingRow: existing,
        organizationId,
        companyId,
        siteId,
        contractorProfileId: deployment.contractor_profile_id,
        labourWorkerId: workerId,
        deploymentId: deployment.id,
        periodId: period.id,
        attendanceDate,
        status: summaryStatus(firstShiftStatus as "present" | "absent" | null, secondShiftStatus as "present" | "absent" | null) as any,
        overtimeMinutes: overtime,
        remarks: text(change.remarks),
        source: "manual",
        backdatedReason: attendanceDate < daysBefore(todayInIst(), 2) ? backdatedReason : null,
        actorId: access.auth.user.id,
        actorName: access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User",
        actorEmail: access.auth.user.email || null,
        now,
        extra: {
          site_in_id: null,
          first_half_present: firstHalfPresent,
          second_half_present: secondHalfPresent,
          override_reason: [firstOverrideReason, secondOverrideReason].filter(Boolean).join(" | ") || null,
          proposed_overtime_minutes: overtime,
          approved_overtime_minutes: overtime,
          bonus_minutes: bonus.minutes,
          commercial_model: deployment.commercial_model || "contract_basis",
          manpower_work_order_id: deployment.manpower_work_order_id || null,
        },
      }));
    }

    const { error } = await access.admin
      .from("labour_attendance")
      .upsert(rows, { onConflict: "labour_worker_id,attendance_date" });
    if (error) throw error;
    if (!(existingRows || []).length && ["submitted", "finalized"].includes(period.status)) {
      const nextSummary = {
        ...(period.summary || {}),
        date_statuses: {
          ...(period.summary?.date_statuses || {}),
          [attendanceDate]: {
            status: "draft",
            saved_at: now,
            saved_by: access.auth.user.id,
          },
        },
      };
      const { error: summaryError } = await access.admin
        .from("labour_attendance_periods")
        .update({ summary: nextSummary, updated_at: now, ...actorFields(access.auth, "updated") })
        .eq("id", period.id);
      if (summaryError) throw summaryError;
    }
    for (const entry of overrideAudits) {
      await audit(access, request, {
        moduleCode: "labour_attendance",
        action: "update",
        entityType: "labour_attendance",
        recordId: entry.attendanceId || period.id,
        organizationId,
        companyId,
        siteId,
        description: `Overrode ${entry.shift.replace("_", " ")} attendance from Absent to Present for ${attendanceDate}.`,
        oldValues: { labour_worker_id: entry.workerId, shift: entry.shift, status: entry.previous },
        newValues: { labour_worker_id: entry.workerId, shift: entry.shift, status: entry.next, reason: entry.reason },
      });
    }
    await audit(access, request, {
      moduleCode: "labour_attendance",
      action: "update",
      entityType: "labour_attendance",
      recordId: period.id,
      organizationId,
      companyId,
      siteId,
      description: `Saved labour attendance for ${attendanceDate}.`,
      newValues: { saved_rows: rows.length, contractor_profile_id: contractorProfileId },
    });
    return NextResponse.json({ saved: rows.length });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save labour attendance.", 500);
  }
}
