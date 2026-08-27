import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  applyCompanySiteScope,
  isAssignedLabourHoHr,
  isAssignedMusterPm,
  isGlobalOrSuperAdmin,
  jsonError,
  loadEligibleDeployments,
  loadResolvedLabourSitePairs,
  originatingAttendanceSystem,
  requireLabourPermission,
  resolveSiteAttendanceSystem,
  validateLabourCompanySiteIndependent,
  validateLabourOperationalCompanySite,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { dateText } from "@/lib/labour/v2";
import type { ErpAuditAction } from "@/lib/serverAudit";

const ACTIVE_STATUSES = ["pending_pm_approval", "pending_ho_approval", "sent_back_by_pm", "sent_back_by_ho", "final_approved"];
const EDITABLE_STATUSES = ["draft", "sent_back_by_pm", "sent_back_by_ho"];
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function pageNumber(value: unknown) {
  const next = Number(value || 1);
  return Number.isSafeInteger(next) && next > 0 ? next : 1;
}

function pageSize(value: unknown) {
  const next = Number(value || PAGE_SIZE_DEFAULT);
  if (!Number.isSafeInteger(next) || next <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(next, PAGE_SIZE_MAX);
}

function numericHours(minutes: unknown) {
  const value = Number(minutes || 0);
  return value ? Math.round((value / 60) * 100) / 100 : 0;
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return 31;
  return new Date(year, monthNumber, 0).getDate();
}

function labourDailyCode(row: any) {
  if (!row) return "-";
  if (row.first_half_present === true && row.second_half_present === true) return "P";
  if (row.first_half_present === false && row.second_half_present === false) return "A";
  if (row.first_half_present === true || row.second_half_present === true || row.first_half_present === false || row.second_half_present === false) return "HD";
  return "-";
}

function rupeeRateLabel(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "-";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function monthStart(value?: string | null) {
  const date = dateText(value);
  return date ? `${date.slice(0, 7)}-01` : null;
}

function actorName(access: any) {
  return access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
}

function hasPermission(access: any, moduleCode: string, actionCode: string) {
  return (access.auth.permissions || []).some((permission: any) =>
    permission.allowed === true &&
    ((permission.module_code === "*" && permission.action_code === "*") ||
      (permission.module_code === moduleCode && permission.action_code === actionCode))
  );
}

function allowedApprovalStatuses(access: any) {
  const all = new Set(ACTIVE_STATUSES);
  if (hasPermission(access, "*", "*")) return all;
  const canPm = hasPermission(access, "labour_daily_submission", "pm_approve") || hasPermission(access, "labour_daily_submission", "pm_send_back");
  const canHo = hasPermission(access, "labour_daily_submission", "ho_approve") || hasPermission(access, "labour_daily_submission", "ho_send_back");
  const canSubmit = hasPermission(access, "labour_daily_submission", "submit");
  const statuses = new Set<string>();
  if (canPm) {
    statuses.add("pending_pm_approval");
    statuses.add("sent_back_by_pm");
    statuses.add("pending_ho_approval");
    statuses.add("final_approved");
  }
  if (canHo) {
    statuses.add("pending_ho_approval");
    statuses.add("sent_back_by_ho");
    statuses.add("final_approved");
  }
  if (canSubmit) {
    statuses.add("sent_back_by_pm");
    statuses.add("sent_back_by_ho");
    statuses.add("final_approved");
  }
  return statuses;
}

function approvalStatusAllowed(access: any, status: string | null | undefined) {
  return Boolean(status && allowedApprovalStatuses(access).has(status));
}

function isPmQueueStatus(status: string | null | undefined) {
  return status === "pending_pm_approval" || status === "sent_back_by_pm";
}

function workflowFromApprovalStatus(status: string | null | undefined) {
  if (status === "submitted" || status === "finalized" || status === "reopened") return "standard";
  if (status && ACTIVE_STATUSES.includes(status)) return "site_in_engineer";
  return null;
}

function standardStatusFromFilter(status: string | null | undefined) {
  if (!status || status === "all") return status || null;
  if (status === "pending") return "submitted";
  if (status === "approved") return "finalized";
  if (status === "sent_back") return "reopened";
  if (status === "pending_pm_approval" || status === "pending_ho_approval") return "submitted";
  if (status === "final_approved") return "finalized";
  if (status === "sent_back_by_pm" || status === "sent_back_by_ho") return "reopened";
  return status;
}

function engineerStatusesFromFilter(status: string | null | undefined, allowedStatuses: Set<string>) {
  const allowed = (values: string[]) => values.filter((value) => allowedStatuses.has(value));
  if (!status || status === "pending") return allowed(["pending_pm_approval", "pending_ho_approval"]);
  if (status === "approved") return allowed(["final_approved"]);
  if (status === "sent_back") return allowed(["sent_back_by_pm", "sent_back_by_ho"]);
  if (status === "all") return Array.from(allowedStatuses);
  if (ACTIVE_STATUSES.includes(status) && allowedStatuses.has(status)) return [status];
  return allowed(["pending_pm_approval", "pending_ho_approval"]);
}

function normalizeStandardStatus(status: unknown) {
  const value = text(status);
  if (value === "submitted" || value === "finalized" || value === "reopened" || value === "draft" || value === "cancelled") return value;
  return null;
}

function standardDateStatus(period: any, workDate?: string | null, hasRows = true) {
  const date = dateText(workDate);
  if (date) return normalizeStandardStatus(period?.summary?.date_statuses?.[date]?.status) || "draft";
  const periodStatus = normalizeStandardStatus(period?.status) || "draft";
  if (date && !hasRows && ["submitted", "finalized"].includes(periodStatus)) return "draft";
  return periodStatus;
}

function standardDateStatusMatches(period: any, workDate: string | null | undefined, requestedStatus: string | null, hasRows = true) {
  return !requestedStatus || standardDateStatus(period, workDate, hasRows) === requestedStatus;
}

function standardSummaryWithDateStatus(period: any, workDate: string, status: string, patch: Record<string, unknown>) {
  const summary = period?.summary && typeof period.summary === "object" && !Array.isArray(period.summary) ? { ...period.summary } : {};
  const dateStatuses = summary.date_statuses && typeof summary.date_statuses === "object" && !Array.isArray(summary.date_statuses)
    ? { ...summary.date_statuses }
    : {};
  dateStatuses[workDate] = {
    ...(dateStatuses[workDate] && typeof dateStatuses[workDate] === "object" ? dateStatuses[workDate] : {}),
    ...patch,
    status,
  };
  return { ...summary, date_statuses: dateStatuses };
}

async function canAccessSubmissionStage(access: any, submission: any) {
  if (isGlobalOrSuperAdmin(access)) return true;
  const status = submission?.status;
  if (!approvalStatusAllowed(access, status)) return false;
  const canPm = hasPermission(access, "labour_daily_submission", "pm_approve") || hasPermission(access, "labour_daily_submission", "pm_send_back");
  const canHo = hasPermission(access, "labour_daily_submission", "ho_approve") || hasPermission(access, "labour_daily_submission", "ho_send_back");
  if (isPmQueueStatus(status)) {
    return canPm && await isAssignedMusterPm(access, {
      organizationId: submission.organization_id,
      companyId: submission.company_id,
      siteId: submission.site_id,
    });
  }
  if (canHo && ["pending_ho_approval", "sent_back_by_ho", "final_approved"].includes(status)) {
    return isAssignedLabourHoHr(access, { organizationId: submission.organization_id });
  }
  if (canPm && ["pending_ho_approval", "final_approved"].includes(status)) {
    return isAssignedMusterPm(access, {
      organizationId: submission.organization_id,
      companyId: submission.company_id,
      siteId: submission.site_id,
    });
  }
  return false;
}

async function assignedPmSiteIds(access: any) {
  if (isGlobalOrSuperAdmin(access)) return null;
  const { data, error } = await access.admin
    .from("labour_site_configurations")
    .select("site_id")
    .eq("pm_user_id", access.auth.user.id)
    .eq("status", "active");
  if (error && error.code !== "42P01") throw error;
  return Array.from(new Set((data || []).map((row: any) => row.site_id).filter(Boolean)));
}

async function assignedHoOrganizationIds(access: any) {
  if (isGlobalOrSuperAdmin(access)) return null;
  const { data, error } = await access.admin
    .from("labour_organization_configurations")
    .select("organization_id")
    .eq("ho_hr_user_id", access.auth.user.id)
    .eq("status", "active");
  if (error && error.code !== "42P01") throw error;
  return Array.from(new Set((data || []).map((row: any) => row.organization_id).filter(Boolean)));
}

async function loadApprovalSiteOptions(access: any, canPm: boolean, canHo: boolean, canViewApproval = false) {
  if (!canPm && !canHo && !canViewApproval && !isGlobalOrSuperAdmin(access)) return { sites: [], companies: [] };
  const resolved = await loadResolvedLabourSitePairs(access);
  return {
    sites: resolved.sites.map((site: any) => ({
      id: site.id,
      name: site.site_name,
      site_name: site.site_name,
      site_code: site.site_code,
      company_id: site.company_id,
      organization_id: site.organization_id,
      status: site.status,
    })),
    companies: resolved.companies.map((company: any) => ({
      id: company.id,
      name: company.company_name,
      company_name: company.company_name,
      organization_id: company.organization_id,
      status: company.status,
    })),
  };
}

async function validateApprovalCompanySiteLookup(access: any, organizationId: string | null, companyId: string, siteId: string) {
  return validateLabourOperationalCompanySite(access, organizationId, companyId, siteId);
}

async function resolveContext(access: any, input: any) {
  const companyId = text(input.company_id);
  const siteId = text(input.site_id);
  const workDate = dateText(input.work_date || input.attendance_date);
  const contractorProfileId = text(input.contractor_profile_id);
  const requestedOrganizationId = text(input.organization_id) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
  if (!companyId || !siteId || !workDate || !contractorProfileId) return { error: "Company, site, date and contractor are required." };
  const scopeCheck = await validateLabourCompanySiteIndependent(access, requestedOrganizationId, companyId, siteId);
  if ("error" in scopeCheck) return { error: scopeCheck.error || "Selected company/site is not available.", status: 403 };
  const { data: contractor, error } = await access.admin
    .from("labour_contractor_profiles")
    .select("id, organization_id, contractor_status")
    .eq("id", contractorProfileId)
    .maybeSingle();
  if (error) throw error;
  if (!contractor || contractor.organization_id !== scopeCheck.organizationId || contractor.contractor_status !== "active") {
    return { error: "Selected contractor is not available.", status: 403 };
  }
  return { organizationId: scopeCheck.organizationId, companyId, siteId, workDate, contractorProfileId };
}

async function loadPackageData(access: any, context: any) {
  let packageSiteIns: any[] = [];
  let engineerAssignment: any = null;
  let packageGroups: any[] = [];
  let engineerGroupIds: string[] | null = null;
  if (context.engineerEmployeeId) {
    const [{ data: assignments, error: assignmentError }, { data: engineer, error: engineerError }, { data: groups, error: groupsError }] = await Promise.all([
      access.admin
        .from("labour_site_in_engineer_assignments")
        .select("*, labour_site_ins(*, labour_workers(id, labour_code, worker_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name)))")
        .eq("organization_id", context.organizationId)
        .eq("company_id", context.companyId)
        .eq("site_id", context.siteId)
        .eq("contractor_profile_id", context.contractorProfileId)
        .eq("site_in_date", context.workDate)
        .eq("engineer_employee_id", context.engineerEmployeeId)
        .eq("status", "active"),
      access.admin
        .from("hr_employees")
        .select("id, employee_name, user_id")
        .eq("id", context.engineerEmployeeId)
        .maybeSingle(),
      access.admin
        .from("labour_work_groups")
        .select("id, group_number, group_label, crew_name, contractor_profile_id, status")
        .eq("organization_id", context.organizationId)
        .eq("company_id", context.companyId)
        .eq("site_id", context.siteId)
        .eq("contractor_profile_id", context.contractorProfileId)
        .eq("work_date", context.workDate)
        .eq("engineer_employee_id", context.engineerEmployeeId)
        .eq("group_type", "engineer_group")
        .neq("status", "cancelled"),
    ]);
    if (assignmentError) throw assignmentError;
    if (engineerError) throw engineerError;
    if (groupsError) throw groupsError;
    packageSiteIns = (assignments || []).map((assignment: any) => Array.isArray(assignment.labour_site_ins) ? assignment.labour_site_ins[0] : assignment.labour_site_ins).filter(Boolean);
    engineerAssignment = {
      engineer_employee_id: context.engineerEmployeeId,
      engineer_user_id: engineer?.user_id || context.engineerUserId || null,
      engineer_employee_name: engineer?.employee_name || null,
    };
    packageGroups = groups || [];
    engineerGroupIds = packageGroups.map((group: any) => group.id).filter(Boolean);
  } else {
    const [{ data: siteIns, error: siteInError }, { data: assignment, error: assignmentError }] = await Promise.all([
      access.admin
        .from("labour_site_ins")
        .select("*, labour_workers(id, labour_code, worker_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
        .eq("organization_id", context.organizationId)
        .eq("company_id", context.companyId)
        .eq("site_id", context.siteId)
        .eq("contractor_profile_id", context.contractorProfileId)
        .eq("site_in_date", context.workDate)
        .eq("status", "active"),
      access.admin
        .from("labour_daily_work_engineer_assignments")
        .select("*, profiles(id, email, full_name)")
        .eq("organization_id", context.organizationId)
        .eq("company_id", context.companyId)
        .eq("site_id", context.siteId)
        .eq("contractor_profile_id", context.contractorProfileId)
        .eq("work_date", context.workDate)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    if (siteInError) throw siteInError;
    if (assignmentError) throw assignmentError;
    packageSiteIns = siteIns || [];
    engineerAssignment = assignment || null;
  }
  let workLogQuery = access.admin
    .from("labour_daily_work_logs")
    .select("*, labour_photo_evidence(id, photo_type, is_active, original_file_name, captured_at, capture_source, server_received_at, uploaded_by_name, uploaded_by_email)")
    .eq("organization_id", context.organizationId)
    .eq("company_id", context.companyId)
    .eq("site_id", context.siteId)
    .eq("contractor_profile_id", context.contractorProfileId)
    .eq("work_date", context.workDate)
    .order("created_at", { ascending: true });
  if (engineerGroupIds) {
    if (!engineerGroupIds.length) return { siteIns: packageSiteIns, attendance: [], workLogs: [], engineerAssignment, attendance_context: { same_scope_worker_attendance_count: 0, unresolved_attendance_count: 0 } };
    workLogQuery = workLogQuery.in("work_group_id", engineerGroupIds);
  }
  const { data: workLogs, error: workLogError } = await workLogQuery;
  if (workLogError) throw workLogError;
  if (!context.engineerEmployeeId && (workLogs || []).length) {
    const ids = Array.from(new Set((workLogs || []).map((log: any) => log.work_group_id).filter(Boolean)));
    if (ids.length) {
      const { data: groups, error: groupsError } = await access.admin
        .from("labour_work_groups")
        .select("id, group_number, group_label, crew_name, contractor_profile_id, status")
        .in("id", ids);
      if (groupsError) throw groupsError;
      packageGroups = groups || [];
    }
  }
  const groupIds = Array.from(new Set(packageGroups.map((group: any) => group.id).filter(Boolean)));
  const [membersResult, groupPhotosResult] = groupIds.length ? await Promise.all([
    access.admin
      .from("labour_work_group_members")
      .select("id, work_group_id, labour_worker_id, status")
      .in("work_group_id", groupIds)
      .eq("status", "active"),
    access.admin
      .from("labour_photo_evidence")
      .select("id, reference_id, work_group_id, original_file_name, captured_at, capture_source, server_received_at, uploaded_by_name, uploaded_by_email, is_active")
      .eq("reference_type", "work_group")
      .in("reference_id", groupIds)
      .eq("is_active", true)
      .order("server_received_at", { ascending: false }),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (membersResult.error) throw membersResult.error;
  if (groupPhotosResult.error) throw groupPhotosResult.error;
  const siteInIds = new Set(packageSiteIns.map((row: any) => row.id).filter(Boolean));
  const deploymentIds = new Set(packageSiteIns.map((row: any) => row.deployment_id).filter(Boolean));
  const workerIds = Array.from(new Set(packageSiteIns.map((row: any) => row.labour_worker_id).filter(Boolean)));
  const { data: attendance, error: attendanceError } = workerIds.length
    ? await access.admin
        .from("labour_attendance")
        .select("*, labour_workers(id, labour_code, worker_name)")
        .eq("organization_id", context.organizationId)
        .eq("company_id", context.companyId)
        .eq("site_id", context.siteId)
        .eq("attendance_date", context.workDate)
        .in("labour_worker_id", workerIds)
    : { data: [], error: null };
  if (attendanceError) throw attendanceError;
  const attendanceForPackage = (attendance || []).filter((row: any) =>
    row.contractor_profile_id === context.contractorProfileId ||
    (row.site_in_id && siteInIds.has(row.site_in_id)) ||
    (row.deployment_id && deploymentIds.has(row.deployment_id))
  );
  const unresolvedAttendanceCount = Math.max((attendance || []).length - attendanceForPackage.length, 0);
  const tradeIds = Array.from(new Set(attendanceForPackage.map((row: any) => row.trade_id).filter(Boolean)));
  const { data: trades, error: tradeError } = tradeIds.length
    ? await access.admin
        .from("labour_trades")
        .select("id, trade_name")
        .eq("organization_id", context.organizationId)
        .in("id", tradeIds)
    : { data: [], error: null };
  if (tradeError) throw tradeError;
  const tradeById = new Map((trades || []).map((trade: any) => [trade.id, trade]));
  const attendanceRows = attendanceForPackage.map((row: any) => ({
    ...row,
    labour_trade: row.trade_id ? tradeById.get(row.trade_id) || null : null,
  }));
  return {
    siteIns: packageSiteIns,
    attendance: attendanceRows,
    workLogs: workLogs || [],
    engineerAssignment,
    groups: packageGroups,
    groupMembers: membersResult.data || [],
    groupPhotos: groupPhotosResult.data || [],
    attendance_context: {
      same_scope_worker_attendance_count: (attendance || []).length,
      unresolved_attendance_count: unresolvedAttendanceCount,
    },
  };
}

function photoCount(log: any) {
  return (log.labour_photo_evidence || []).filter((photo: any) => photo.is_active !== false).length;
}

function packageContractorName(data: any) {
  const contractor = data.siteIns?.[0]?.labour_contractor_profiles;
  return contractor?.vendors?.vendor_name || contractor?.contractor_code || "selected contractor";
}

function packageDateLabel(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return String(value || "selected date");
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function statusBucket(status: string | null | undefined) {
  if (status === "final_approved") return "approved";
  if (status === "sent_back_by_pm" || status === "sent_back_by_ho") return "sent_back";
  if (status === "cancelled") return "rejected";
  if (status === "pending_pm_approval" || status === "pending_ho_approval") return "pending";
  return "other";
}

function labourerText(count: number) {
  return `${count} labourer${count === 1 ? "" : "s"}`;
}

function validateReadyForSubmit(data: any, context: any) {
  const contractorName = packageContractorName(data);
  const dateLabel = packageDateLabel(context.workDate);
  if (!data.siteIns.length) return `No Site-In labour exists for ${contractorName} on ${dateLabel}.`;
  if (!data.attendance.length) {
    if (data.attendance_context?.unresolved_attendance_count > 0) return "Attendance contractor context could not be resolved.";
    return `No saved Attendance found for ${contractorName} on ${dateLabel}.`;
  }
  if (data.attendance.length < data.siteIns.length) {
    return `Attendance exists for ${labourerText(data.attendance.length)} of ${data.siteIns.length} Site-In labourers for ${contractorName} on ${dateLabel}.`;
  }
  const firstMissing = data.attendance.filter((row: any) => row.first_half_present === null || row.first_half_present === undefined).length;
  if (firstMissing > 0) return `Attendance exists, but First Shift is not marked for ${labourerText(firstMissing)}.`;
  const secondMissing = data.attendance.filter((row: any) => row.second_half_present === null || row.second_half_present === undefined).length;
  if (secondMissing > 0) {
    return `Attendance exists, but Second Shift is not marked for ${labourerText(secondMissing)}.`;
  }
  if (!data.workLogs.length) return "Daily Work draft entries must be saved before submitting.";
  for (const log of data.workLogs) {
    if (log.status !== "draft" && log.status !== "submitted") return "Only Draft Daily Work rows can be submitted.";
    if (log.work_type === "productive" && photoCount(log) <= 0) return "Productive Daily Work rows require photo evidence.";
  }
  return null;
}

function buildSnapshot(data: any) {
  const firstPresent = data.attendance.filter((row: any) => row.first_half_present === true).length;
  const firstAbsent = data.attendance.filter((row: any) => row.first_half_present === false).length;
  const secondPresent = data.attendance.filter((row: any) => row.second_half_present === true).length;
  const secondAbsent = data.attendance.filter((row: any) => row.second_half_present === false).length;
  const totalOtMinutes = data.attendance.reduce((sum: number, row: any) => sum + Number(row.overtime_minutes || row.approved_overtime_minutes || 0), 0);
  const totalBonusMinutes = data.attendance.reduce((sum: number, row: any) => sum + Number(row.bonus_minutes || 0), 0);
  const siteInByWorkerId = new Map<string, any>(data.siteIns.map((row: any) => [row.labour_worker_id, row]));
  const attendanceByWorkerId = new Map<string, any>(data.attendance.map((row: any) => [row.labour_worker_id, row]));
  const membersByGroup = new Map<string, any[]>();
  for (const member of data.groupMembers || []) {
    membersByGroup.set(member.work_group_id, [...(membersByGroup.get(member.work_group_id) || []), member]);
  }
  const workLogByGroup = new Map((data.workLogs || []).map((log: any) => [log.work_group_id, log]));
  const photosByGroup = new Map<string, any[]>();
  for (const photo of data.groupPhotos || []) {
    photosByGroup.set(photo.reference_id, [...(photosByGroup.get(photo.reference_id) || []), photo]);
  }
  const groupSummaries = (data.groups || []).map((group: any) => {
    const members = membersByGroup.get(group.id) || [];
    const memberWorkerIds = new Set(members.map((member: any) => member.labour_worker_id).filter(Boolean));
    const groupAttendance = data.attendance.filter((row: any) => memberWorkerIds.has(row.labour_worker_id));
    const workLog: any = workLogByGroup.get(group.id);
    const groupPhotos = photosByGroup.get(group.id) || [];
    const otMinutes = groupAttendance.reduce((sum: number, row: any) => sum + Number(row.overtime_minutes || row.approved_overtime_minutes || 0), 0);
    const bonusMinutes = groupAttendance.reduce((sum: number, row: any) => sum + Number(row.bonus_minutes || 0), 0);
    return {
      id: group.id,
      group_number: group.group_number,
      group_name: group.group_label || group.crew_name || `Group ${group.group_number || ""}`.trim(),
      contractor_profile_id: group.contractor_profile_id,
      labour_count: members.length,
      site_in_count: members.filter((member: any) => siteInByWorkerId.has(member.labour_worker_id)).length,
      first_half_present: groupAttendance.filter((row: any) => row.first_half_present === true).length,
      first_half_absent: groupAttendance.filter((row: any) => row.first_half_present === false).length,
      second_half_present: groupAttendance.filter((row: any) => row.second_half_present === true).length,
      second_half_absent: groupAttendance.filter((row: any) => row.second_half_present === false).length,
      ot_hours: Math.round((otMinutes / 60) * 100) / 100,
      bonus_hours: Math.round((bonusMinutes / 60) * 100) / 100,
      work_log_id: workLog?.id || null,
      work_type: workLog?.work_type || null,
      work_description: workLog?.activity || null,
      quantity: workLog?.quantity ?? null,
      unit: workLog?.unit || null,
      photo_count: groupPhotos.length,
      productive_photo_missing: workLog?.work_type === "productive" && groupPhotos.length <= 0,
      remarks: workLog?.remarks || null,
      member_worker_ids: Array.from(memberWorkerIds),
    };
  });
  return {
    site_in_count: data.siteIns.length,
    attendance_count: data.attendance.length,
    daily_work_count: data.workLogs.length,
    group_count: groupSummaries.length,
    photo_count: (data.groupPhotos || []).length,
    assigned_engineer_employee_id: data.engineerAssignment?.engineer_employee_id || null,
    assigned_engineer_user_id: data.engineerAssignment?.engineer_user_id || null,
    assigned_engineer_name: data.engineerAssignment?.engineer_employee_name || data.engineerAssignment?.profiles?.full_name || data.engineerAssignment?.profiles?.email || null,
    assigned_engineer_email: data.engineerAssignment?.profiles?.email || null,
    attendance_summary: {
      first_shift_present: firstPresent,
      first_shift_absent: firstAbsent,
      second_shift_present: secondPresent,
      second_shift_absent: secondAbsent,
      ot_labour_count: data.attendance.filter((row: any) => Number(row.overtime_minutes || row.approved_overtime_minutes || 0) > 0).length,
      total_ot_hours: Math.round((totalOtMinutes / 60) * 100) / 100,
      total_bonus_hours: Math.round((totalBonusMinutes / 60) * 100) / 100,
    },
    warnings: [
      data.attendance.length !== data.siteIns.length ? "Attendance count differs from Site-In count." : null,
      groupSummaries.some((group: any) => group.productive_photo_missing) ? "Productive row missing photo." : null,
    ].filter(Boolean),
    group_summary: groupSummaries,
    attendance_rows: data.attendance.map((row: any) => {
      const siteIn = siteInByWorkerId.get(row.labour_worker_id);
      const group = groupSummaries.find((item: any) => (item.member_worker_ids || []).includes(row.labour_worker_id));
      return {
        id: row.id,
        labour_worker_id: row.labour_worker_id,
        work_group_id: group?.id || null,
        group_name: group?.group_name || null,
        labour_code: row.labour_workers?.labour_code || null,
        labour_name: row.labour_workers?.worker_name || null,
        contractor_name: siteIn?.labour_contractor_profiles?.vendors?.vendor_name || siteIn?.labour_contractor_profiles?.contractor_code || null,
        category: row.labour_trade?.trade_name || null,
        daily_rate: row.daily_rate || null,
        site_in_id: row.site_in_id || null,
        site_in_time: siteIn?.site_in_time || null,
        first_half_present: row.first_half_present,
        second_half_present: row.second_half_present,
        overtime_minutes: row.overtime_minutes || 0,
        bonus_minutes: row.bonus_minutes || 0,
        remarks: row.remarks || null,
      };
    }),
    work_logs: data.workLogs.map((log: any) => ({
      id: log.id,
      work_group_id: log.work_group_id || null,
      group_name: groupSummaries.find((group: any) => group.id === log.work_group_id)?.group_name || null,
      contractor_profile_id: log.contractor_profile_id,
      labour_count: groupSummaries.find((group: any) => group.id === log.work_group_id)?.labour_count || 0,
      work_type: log.work_type,
      work_description: log.activity,
      quantity: log.quantity,
      unit: log.unit,
      photo_count: (photosByGroup.get(log.work_group_id) || []).length,
      productive_photo_missing: log.work_type === "productive" && !(photosByGroup.get(log.work_group_id) || []).length,
      photos: (photosByGroup.get(log.work_group_id) || [])
        .map((photo: any) => ({
          id: photo.id,
          work_group_id: log.work_group_id || null,
          group_name: groupSummaries.find((group: any) => group.id === log.work_group_id)?.group_name || null,
          work_activity: log.activity || null,
          file_name: photo.original_file_name,
          captured_at: photo.captured_at || null,
          uploaded_at: photo.server_received_at || null,
          capture_source: photo.capture_source || null,
          uploaded_by: photo.uploaded_by_name || photo.uploaded_by_email || null,
        })),
      remarks: log.remarks || null,
    })),
    photos: (data.groupPhotos || []).map((photo: any) => {
      const group = groupSummaries.find((item: any) => item.id === (photo.reference_id || photo.work_group_id));
      const workLog: any = workLogByGroup.get(photo.reference_id || photo.work_group_id);
      return {
        id: photo.id,
        work_group_id: photo.reference_id || photo.work_group_id || null,
        group_name: group?.group_name || null,
        work_activity: workLog?.activity || null,
        file_name: photo.original_file_name,
        captured_at: photo.captured_at || null,
        uploaded_at: photo.server_received_at || null,
        capture_source: photo.capture_source || null,
        uploaded_by: photo.uploaded_by_name || photo.uploaded_by_email || null,
      };
    }),
  };
}

async function loadSubmission(access: any, id: string) {
  const { data, error } = await access.admin
    .from("labour_daily_submissions")
    .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function snapshotNeedsApprovalDetail(snapshot: any) {
  if (!snapshot) return true;
  const attendanceRows = snapshot.attendance_rows || [];
  const workLogs = snapshot.work_logs || [];
  if (!snapshot.assigned_engineer_name && !snapshot.assigned_engineer_email) return true;
  if (attendanceRows.some((row: any) => !row.category || !row.site_in_time)) return true;
  if (workLogs.some((log: any) => (log.photos || []).some((photo: any) => !photo.captured_at && !photo.uploaded_at))) return true;
  return false;
}

function engineerNameFromSubmission(submission: any, employeeById: Map<string, any>) {
  const engineerId = submission.engineer_employee_id || text(submission.snapshot?.engineer_employee_id);
  const employee = engineerId ? employeeById.get(engineerId) : null;
  return employee?.employee_name || submission.snapshot?.assigned_engineer_name || submission.snapshot?.assigned_engineer_email || "Engineer not recorded";
}

function compactSubmission(submission: any, employeeById: Map<string, any>) {
  const snapshot = submission.snapshot || {};
  const groupSummary = snapshot.group_summary || [];
  const workLogs = snapshot.work_logs || [];
  const attendanceSummary = snapshot.attendance_summary || {};
  const attendanceRows = snapshot.attendance_rows || [];
  const photoCountValue = Number(snapshot.photo_count ?? workLogs.reduce((sum: number, log: any) => sum + Number(log.photo_count || 0), 0));
  const missingPhotoCount = groupSummary.filter((group: any) => group.productive_photo_missing).length || workLogs.filter((log: any) => log.productive_photo_missing).length;
  const otCount = attendanceRows.filter((row: any) => Number(row.overtime_minutes || row.approved_overtime_minutes || 0) > 0).length;
  const bonusCount = attendanceRows.filter((row: any) => Number(row.bonus_minutes || 0) > 0).length;
  return {
    id: submission.id,
    organization_id: submission.organization_id,
    company_id: submission.company_id,
    site_id: submission.site_id,
    contractor_profile_id: submission.contractor_profile_id,
    engineer_employee_id: submission.engineer_employee_id || text(snapshot.engineer_employee_id),
    engineer_user_id: submission.engineer_user_id || text(snapshot.engineer_user_id),
    engineer_name: engineerNameFromSubmission(submission, employeeById),
    company_name: submission.companies?.company_name || "-",
    site_name: submission.sites?.site_name || "-",
    contractor_name: submission.labour_contractor_profiles?.vendors?.vendor_name || submission.labour_contractor_profiles?.contractor_code || "Contractor",
    work_date: submission.work_date,
    status: submission.status,
    submission_version: submission.submission_version,
    submitted_by_name: submission.submitted_by_name,
    submitted_by_email: submission.submitted_by_email,
    submitted_at: submission.submitted_at,
    send_back_reason: submission.ho_send_back_reason || submission.pm_send_back_reason || null,
    sent_back_by_name: submission.ho_sent_back_by_name || submission.pm_sent_back_by_name || null,
    sent_back_by_email: submission.ho_sent_back_by_email || submission.pm_sent_back_by_email || null,
    sent_back_at: submission.ho_sent_back_at || submission.pm_sent_back_at || null,
    groups_count: Number(snapshot.group_count ?? groupSummary.length ?? workLogs.length ?? 0),
    labourers_count: Number(snapshot.site_in_count || snapshot.attendance_count || 0),
    present_count: Number(attendanceSummary.first_shift_present || 0),
    absent_count: Number(attendanceSummary.first_shift_absent || 0),
    ot_count: otCount,
    bonus_count: bonusCount,
    attendance_exceptions: Number(snapshot.warnings?.length || 0) + Number(missingPhotoCount || 0),
    attendance_complete: Number(snapshot.attendance_count || 0) > 0 && Number(snapshot.attendance_count || 0) === Number(snapshot.site_in_count || 0),
    daily_work_rows: Number(snapshot.daily_work_count ?? workLogs.length ?? 0),
    photo_count: photoCountValue,
    missing_photo_count: missingPhotoCount,
  };
}

function compactStandardPeriod(period: any, attendanceRows: any[], workDate?: string | null) {
  const realRows = attendanceRows.filter((row: any) => row.labour_worker_id);
  const presentCount = realRows.filter((row: any) => row.first_half_present === true || row.second_half_present === true).length;
  const absentCount = realRows.filter((row: any) => row.first_half_present === false && row.second_half_present === false).length;
  const halfDayCount = realRows.filter((row: any) =>
    (row.first_half_present === true && row.second_half_present === false) ||
    (row.first_half_present === false && row.second_half_present === true)
  ).length;
  const pendingCount = realRows.filter((row: any) =>
    row.first_half_present !== true &&
    row.first_half_present !== false &&
    row.second_half_present !== true &&
    row.second_half_present !== false
  ).length;
  const otCount = realRows.filter((row: any) => Number(row.overtime_minutes || row.approved_overtime_minutes || 0) > 0).length;
  const bonusCount = realRows.filter((row: any) => Number(row.bonus_minutes || 0) > 0).length;
  const totalOtMinutes = realRows.reduce((sum: number, row: any) => sum + Number(row.overtime_minutes || row.approved_overtime_minutes || 0), 0);
  const totalBonusMinutes = realRows.reduce((sum: number, row: any) => sum + Number(row.bonus_minutes || 0), 0);
  const attendanceExceptions = realRows.filter((row: any) =>
    row.first_half_present === null || row.first_half_present === undefined ||
    row.second_half_present === null || row.second_half_present === undefined ||
    Number(row.overtime_minutes || row.approved_overtime_minutes || 0) > 0 ||
    Number(row.bonus_minutes || 0) > 0,
  ).length;
  const dateSummary = period?.summary?.date_statuses?.[dateText(workDate) || ""] || {};
  return {
    id: period.id,
    submission_id: period.id,
    attendance_period_id: period.id,
    organization_id: period.organization_id,
    company_id: period.company_id,
    site_id: period.site_id,
    contractor_profile_id: period.contractor_profile_id,
    company_name: period.companies?.company_name || "-",
    site_name: period.sites?.site_name || "-",
    contractor_name: period.labour_contractor_profiles?.vendors?.vendor_name || period.labour_contractor_profiles?.contractor_code || "All Contractors",
    work_date: dateText(workDate) || period.period_month,
    period_month: period.period_month,
    submission_type: "Standard Attendance",
    status: standardDateStatus(period, workDate, realRows.length > 0),
    submitted_by_name: dateSummary.submitted_by_name || null,
    submitted_by_email: dateSummary.submitted_by_email || null,
    submitted_at: dateSummary.submitted_at || null,
    approved_by_name: dateSummary.finalized_by_name || null,
    approved_by_email: dateSummary.finalized_by_email || null,
    approved_at: dateSummary.finalized_at || null,
    send_back_reason: dateSummary.reason || null,
    sent_back_by_name: dateSummary.reopened_by_name || null,
    sent_back_by_email: dateSummary.reopened_by_email || null,
    sent_back_at: dateSummary.reopened_at || null,
    labourers_count: realRows.length,
    present_count: presentCount,
    absent_count: absentCount,
    half_day_count: halfDayCount,
    pending_count: pendingCount,
    ot_count: otCount,
    bonus_count: bonusCount,
    total_ot_minutes: totalOtMinutes,
    total_bonus_minutes: totalBonusMinutes,
    attendance_exceptions: attendanceExceptions,
  };
}

export async function enrichStandardSubmitterSnapshots(access: any, periods: any[]) {
  const submitterIds = Array.from(new Set((periods || []).flatMap((period: any) => {
    const statuses = period?.summary?.date_statuses;
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return [];
    return Object.values(statuses).flatMap((entry: any) => [
      entry?.submitted_by_name ? null : text(entry?.submitted_by),
      entry?.finalized_by_name ? null : text(entry?.finalized_by),
    ]).filter(Boolean);
  }))) as string[];
  if (!submitterIds.length) return periods;
  const { data: profiles, error } = await access.admin.from("profiles").select("id, full_name, email").in("id", submitterIds);
  if (error) throw error;
  const profileById = new Map<string, any>((profiles || []).map((profile: any) => [profile.id, profile]));
  return (periods || []).map((period: any) => {
    const statuses = period?.summary?.date_statuses;
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return period;
    const nextStatuses = Object.fromEntries(Object.entries(statuses).map(([date, entry]: [string, any]) => {
      const nextEntry = { ...entry };
      if (!entry?.submitted_by_name && entry?.submitted_by) {
        const profile = profileById.get(entry.submitted_by);
        if (profile) Object.assign(nextEntry, { submitted_by_name: profile.full_name || profile.email || null, submitted_by_email: profile.email || null });
      }
      if (!entry?.finalized_by_name && entry?.finalized_by) {
        const profile = profileById.get(entry.finalized_by);
        if (profile) Object.assign(nextEntry, { finalized_by_name: profile.full_name || profile.email || null, finalized_by_email: profile.email || null });
      }
      return [date, nextEntry];
    }));
    return { ...period, summary: { ...(period.summary || {}), date_statuses: nextStatuses } };
  });
}

function compactStandardSiteRegister(periods: any[], attendanceRows: any[], workDate?: string | null) {
  const first = periods[0] || {};
  const periodIds = periods.map((period) => period.id).filter(Boolean);
  const registerDate = dateText(workDate) || dateText(attendanceRows.find((row: any) => row.attendance_date)?.attendance_date) || first.period_month;
  const statuses = new Set(periods.map((period) => standardDateStatus(period, registerDate, true)).filter(Boolean));
  const aggregateStatus = statuses.size === 1 ? Array.from(statuses)[0] : statuses.has("submitted") ? "submitted" : statuses.has("reopened") ? "reopened" : statuses.has("finalized") ? "finalized" : first.status;
  const compacted = compactStandardPeriod(first, attendanceRows, registerDate);
  return {
    ...compacted,
    id: `standard:${first.organization_id}:${first.company_id}:${first.site_id}:${registerDate}`,
    submission_id: `standard:${first.organization_id}:${first.company_id}:${first.site_id}:${registerDate}`,
    attendance_period_id: null,
    period_ids: periodIds,
    contractor_profile_id: null,
    contractor_name: "All Contractors",
    work_date: registerDate,
    status: aggregateStatus,
    submitted_by_name: compacted.submitted_by_name || "-",
    submitted_by_email: compacted.submitted_by_email || null,
    submitted_at: compacted.submitted_at || null,
    send_back_reason: compacted.send_back_reason || null,
    sent_back_by_name: compacted.sent_back_by_name || null,
    sent_back_by_email: compacted.sent_back_by_email || null,
    sent_back_at: compacted.sent_back_at || null,
  };
}

function compactStandardSnapshot(period: any, snapshot: any) {
  return {
    id: `standard:${period.organization_id}:${period.company_id}:${period.site_id}:${snapshot.attendance_date}`,
    submission_id: snapshot.id,
    attendance_period_id: period.id,
    period_ids: [period.id],
    organization_id: snapshot.organization_id,
    company_id: snapshot.company_id,
    site_id: snapshot.site_id,
    contractor_profile_id: snapshot.contractor_profile_id,
    company_name: period.companies?.company_name || "-",
    site_name: period.sites?.site_name || "-",
    contractor_name: period.labour_contractor_profiles?.vendors?.vendor_name || period.labour_contractor_profiles?.contractor_code || "All Contractors",
    work_date: snapshot.attendance_date,
    period_month: period.period_month,
    submission_type: "Standard Attendance",
    status: "submitted",
    submitted_by_name: snapshot.submitted_by_name || "-",
    submitted_by_email: snapshot.submitted_by_email || null,
    submitted_at: snapshot.submitted_at,
    labourers_count: snapshot.eligible_worker_count,
    present_count: snapshot.present_count,
    absent_count: snapshot.absent_count,
    half_day_count: snapshot.half_day_count,
    pending_count: snapshot.incomplete_count,
    ot_count: snapshot.overtime_minutes_total > 0 ? 1 : 0,
    bonus_count: snapshot.bonus_minutes_total > 0 ? 1 : 0,
    total_ot_minutes: snapshot.overtime_minutes_total,
    total_bonus_minutes: snapshot.bonus_minutes_total,
    attendance_exceptions: 0,
    submission_version: snapshot.submission_version,
    has_submission_snapshot: true,
  };
}

function snapshotCanonicalStatus(period: any, attendanceDate: string) {
  return normalizeStandardStatus(period?.summary?.date_statuses?.[attendanceDate]?.status) || "submitted";
}

function compactStandardSnapshotAggregate(periods: any[], snapshots: any[], workDate: string) {
  const first = periods[0] || {};
  const latest = [...snapshots].sort((a, b) => Number(b.submission_version || 0) - Number(a.submission_version || 0))[0] || {};
  const sum = (field: string) => snapshots.reduce((total, snapshot) => total + Number(snapshot[field] || 0), 0);
  const statuses = new Set(periods.map((period: any) => snapshotCanonicalStatus(period, workDate)));
  const status = statuses.size === 1 ? Array.from(statuses)[0]
    : statuses.has("reopened") ? "reopened"
    : statuses.has("finalized") ? "finalized"
    : statuses.has("cancelled") ? "cancelled"
    : "submitted";
  return {
    ...compactStandardSnapshot(first, latest),
    id: `standard:${first.organization_id}:${first.company_id}:${first.site_id}:${workDate}`,
    submission_id: `standard:${first.organization_id}:${first.company_id}:${first.site_id}:${workDate}`,
    attendance_period_id: null,
    period_ids: periods.map((period: any) => period.id).filter(Boolean),
    contractor_profile_id: null,
    contractor_name: "All Contractors",
    work_date: workDate,
    status,
    submitted_by_name: latest.submitted_by_name || "-",
    submitted_by_email: latest.submitted_by_email || null,
    submitted_at: latest.submitted_at || null,
    labourers_count: sum("eligible_worker_count"),
    present_count: sum("present_count"),
    absent_count: sum("absent_count"),
    half_day_count: sum("half_day_count"),
    pending_count: sum("incomplete_count"),
    total_ot_minutes: sum("overtime_minutes_total"),
    total_bonus_minutes: sum("bonus_minutes_total"),
    has_submission_snapshot: true,
  };
}

function publicStandardSupportingPdf(row: any) {
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

function summaryCounts(rows: any[]) {
  return {
    engineer_submissions: new Set(rows.map((row) => row.submission_id || row.id).filter(Boolean)).size,
    labourers: rows.filter((row) => row.labour_worker_id).length,
    pending: new Set(rows.filter((row) => statusBucket(row.status) === "pending").map((row) => row.submission_id || row.id)).size,
    approved: new Set(rows.filter((row) => statusBucket(row.status) === "approved").map((row) => row.submission_id || row.id)).size,
    rejected: new Set(rows.filter((row) => statusBucket(row.status) === "rejected").map((row) => row.submission_id || row.id)).size,
    sent_back: new Set(rows.filter((row) => statusBucket(row.status) === "sent_back").map((row) => row.submission_id || row.id)).size,
    attendance_exceptions: rows.filter((row) => row.attendance_exception).length,
    missing_photos: new Set(rows.filter((row) => row.productive_photo_missing).map((row) => row.group_id).filter(Boolean)).size,
  };
}

function standardSummaryCounts(rows: any[]) {
  const realRows = rows.filter((row) => row.labour_worker_id && row.labour_code && row.labour_name);
  if (realRows.length) {
    const periodIds = new Set(realRows.map((row) => row.submission_id || row.attendance_period_id || row.id).filter(Boolean));
    return {
      attendance_periods: periodIds.size,
      labourers: realRows.length,
      pending: new Set(realRows.filter((row) => row.status === "submitted").map((row) => row.submission_id || row.attendance_period_id || row.id).filter(Boolean)).size,
      finalized: new Set(realRows.filter((row) => row.status === "finalized").map((row) => row.submission_id || row.attendance_period_id || row.id).filter(Boolean)).size,
      sent_back: new Set(realRows.filter((row) => row.status === "reopened").map((row) => row.submission_id || row.attendance_period_id || row.id).filter(Boolean)).size,
      attendance_exceptions: realRows.filter((row) => row.attendance_exception).length,
    };
  }
  return {
    attendance_periods: rows.length,
    labourers: rows.reduce((sum, row) => sum + Number(row.labourers_count || 0), 0),
    pending: rows.filter((row) => row.status === "submitted").length,
    finalized: rows.filter((row) => row.status === "finalized").length,
    sent_back: rows.filter((row) => row.status === "reopened").length,
    attendance_exceptions: rows.reduce((sum, row) => sum + Number(row.attendance_exceptions || 0), 0),
  };
}

function groupDisplayName(group: any) {
  if (!group) return "Ungrouped";
  return group.group_name || group.crew_name || group.group_label || (group.group_number ? `Group ${group.group_number}` : "Group");
}

function firstWorkLogForGroup(snapshot: any, groupId?: string | null) {
  return (snapshot.work_logs || []).find((log: any) => log.work_group_id === groupId) || null;
}

function photosForGroup(snapshot: any, groupId?: string | null) {
  return (snapshot.photos || []).filter((photo: any) => photo.work_group_id === groupId);
}

function attendanceException(row: any) {
  if (row.first_half_present === null || row.first_half_present === undefined || row.second_half_present === null || row.second_half_present === undefined) return true;
  if (Number(row.overtime_minutes || 0) > 0) return true;
  if (Number(row.bonus_minutes || 0) > 0) return true;
  return false;
}

function flattenSubmissionForRegister(submission: any, employeeById: Map<string, any>) {
  const snapshot = submission.snapshot || {};
  const groups = snapshot.group_summary || [];
  const attendanceRows = snapshot.attendance_rows || [];
  const fallbackGroup = groups[0] || null;
  const groupById = new Map(groups.map((group: any) => [group.id, group]));
  const engineerName = engineerNameFromSubmission(submission, employeeById);
  const base = {
    submission_id: submission.id,
    organization_id: submission.organization_id,
    company_id: submission.company_id,
    site_id: submission.site_id,
    contractor_profile_id: submission.contractor_profile_id,
    engineer_employee_id: submission.engineer_employee_id || text(snapshot.engineer_employee_id),
    engineer_user_id: submission.engineer_user_id || text(snapshot.engineer_user_id),
    engineer_name: engineerName,
    company_name: submission.companies?.company_name || "-",
    site_name: submission.sites?.site_name || "-",
    contractor_name: submission.labour_contractor_profiles?.vendors?.vendor_name || submission.labour_contractor_profiles?.contractor_code || "Contractor",
    work_date: submission.work_date,
    status: submission.status,
    submitted_at: submission.submitted_at,
    submitted_by_name: submission.submitted_by_name,
    submitted_by_email: submission.submitted_by_email,
  };
  const rows = attendanceRows.map((attendance: any, index: number) => {
    const group = groupById.get(attendance.work_group_id) || fallbackGroup;
    const groupId = attendance.work_group_id || group?.id || null;
    const workLog = firstWorkLogForGroup(snapshot, groupId);
    const photos = photosForGroup(snapshot, groupId);
    const productiveMissing = Boolean(group?.productive_photo_missing || workLog?.productive_photo_missing);
    return {
      id: `${submission.id}:${groupId || "ungrouped"}:${attendance.labour_worker_id || attendance.id || index}`,
      ...base,
      group_id: groupId,
      group_number: group?.group_number || null,
      group_name: groupDisplayName(group),
      labour_worker_id: attendance.labour_worker_id || null,
      labour_code: attendance.labour_code || null,
      labour_name: attendance.labour_name || "-",
      category: attendance.category || "-",
      site_in_time: attendance.site_in_time || null,
      first_half_present: attendance.first_half_present,
      second_half_present: attendance.second_half_present,
      overtime_minutes: Number(attendance.overtime_minutes || 0),
      bonus_minutes: Number(attendance.bonus_minutes || 0),
      labour_remarks: attendance.remarks || null,
      work_log_id: workLog?.id || null,
      work_type: workLog?.work_type || group?.work_type || null,
      work_description: workLog?.work_description || group?.work_description || null,
      quantity: workLog?.quantity ?? group?.quantity ?? null,
      unit: workLog?.unit || group?.unit || null,
      group_remarks: workLog?.remarks || null,
      photo_count: photos.length,
      photo_metadata: photos.map((photo: any) => ({
        id: photo.id,
        file_name: photo.file_name || photo.original_file_name || null,
        captured_at: photo.captured_at || null,
        uploaded_at: photo.uploaded_at || null,
        uploaded_by: photo.uploaded_by || null,
        group_name: photo.group_name || groupDisplayName(group),
        work_activity: photo.work_activity || workLog?.work_description || null,
      })),
      productive_photo_missing: productiveMissing,
      attendance_exception: attendanceException(attendance),
    };
  });
  if (rows.length) return rows;
  return groups.map((group: any, index: number) => {
    const workLog = firstWorkLogForGroup(snapshot, group.id);
    const photos = photosForGroup(snapshot, group.id);
    return {
      id: `${submission.id}:${group.id || index}:empty`,
      ...base,
      group_id: group.id || null,
      group_number: group.group_number || null,
      group_name: groupDisplayName(group),
      labour_worker_id: null,
      labour_code: null,
      labour_name: "-",
      category: "-",
      site_in_time: null,
      first_half_present: null,
      second_half_present: null,
      overtime_minutes: 0,
      bonus_minutes: 0,
      labour_remarks: null,
      work_log_id: workLog?.id || null,
      work_type: workLog?.work_type || group.work_type || null,
      work_description: workLog?.work_description || group.work_description || null,
      quantity: workLog?.quantity ?? group.quantity ?? null,
      unit: workLog?.unit || group.unit || null,
      group_remarks: workLog?.remarks || null,
      photo_count: photos.length,
      photo_metadata: photos,
      productive_photo_missing: Boolean(group.productive_photo_missing || workLog?.productive_photo_missing),
      attendance_exception: true,
    };
  });
}

export async function loadStandardApprovalRows(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  periodId?: string | null;
  periodIds?: string[] | null;
  workDate?: string | null;
  status?: string | null;
  contractorProfileId?: string | null;
  search?: string | null;
}) {
  const periodMonth = monthStart(input.workDate) || monthStart(new Date().toISOString().slice(0, 10));
  const requestedStatus = input.status === "final_approved" ? "finalized"
    : input.status === "sent_back_by_pm" || input.status === "sent_back_by_ho" ? "reopened"
    : input.status === "all" ? null
    : input.status === "submitted" || input.status === "finalized" || input.status === "reopened" || input.status === "draft" || input.status === "cancelled" ? input.status
    : "submitted";
  let periodQuery = access.admin
    .from("labour_attendance_periods")
    .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("period_month", periodMonth)
    .eq("originating_attendance_system", "standard")
    .order("submitted_at", { ascending: false });
  if (input.periodIds?.length) periodQuery = periodQuery.in("id", input.periodIds);
  else if (input.periodId) periodQuery = periodQuery.eq("id", input.periodId);
  periodQuery = applyCompanySiteScope(periodQuery, access.assignments);
  if (!periodQuery) return [];
  const { data: periods, error } = await periodQuery;
  if (error) throw error;
  const enrichedPeriods = await enrichStandardSubmitterSnapshots(access, periods || []);
  const periodIds = enrichedPeriods.map((period: any) => period.id).filter(Boolean);
  if (!periodIds.length) return [];
  if (input.workDate) {
    const { data: snapshot, error: snapshotError } = await access.admin
      .from("labour_attendance_submission_versions")
      .select("*")
      .in("period_id", periodIds)
      .eq("attendance_date", input.workDate)
      .eq("status", "submitted")
      .order("submission_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError && snapshotError.code !== "42P01") throw snapshotError;
    if (snapshot) {
      const snapshotPeriod = enrichedPeriods.find((period: any) => period.id === snapshot.period_id) || enrichedPeriods[0];
      const snapshotRows = await access.admin.from("labour_attendance_submission_version_rows").select("*").eq("submission_version_id", snapshot.id).order("labour_code_snapshot");
      if (snapshotRows.error && snapshotRows.error.code !== "42P01") throw snapshotRows.error;
      const snapshotDeploymentIds = Array.from(new Set((snapshotRows.data || []).map((row: any) => row.deployment_id).filter(Boolean)));
      const { data: snapshotDeployments, error: snapshotDeploymentError } = snapshotDeploymentIds.length
        ? await access.admin.from("labour_deployments").select("id, wage_rate").in("id", snapshotDeploymentIds)
        : { data: [], error: null };
      if (snapshotDeploymentError) throw snapshotDeploymentError;
      const snapshotDeploymentById = new Map<string, any>((snapshotDeployments || []).map((deployment: any) => [deployment.id, deployment]));
      const rows = (snapshotRows.data || []).map((row: any) => ({
        id: `${snapshot.id}:${row.id}`, submission_id: snapshot.id, attendance_period_id: snapshotPeriod.id,
        company_id: snapshot.company_id, site_id: snapshot.site_id, contractor_profile_id: snapshot.contractor_profile_id,
        company_name: snapshotPeriod.companies?.company_name || "-", site_name: snapshotPeriod.sites?.site_name || "-",
        contractor_name: row.contractor_name_snapshot || "-", period_month: snapshotPeriod.period_month, work_date: snapshot.attendance_date,
        labour_worker_id: row.labour_worker_id, labour_code: row.labour_code_snapshot, labour_name: row.worker_name_snapshot,
        category: row.trade_snapshot || "-", first_half_present: row.first_half_present, second_half_present: row.second_half_present,
        deployment_id: row.deployment_id, daily_rate: snapshotDeploymentById.get(row.deployment_id)?.wage_rate ?? null,
        overtime_minutes: row.overtime_minutes, bonus_minutes: row.bonus_minutes, status: row.derived_status,
        register_status: snapshotCanonicalStatus(snapshotPeriod, input.workDate || snapshot.attendance_date), submitted_by_name: snapshot.submitted_by_name, submitted_by_email: snapshot.submitted_by_email,
        submitted_at: snapshot.submitted_at, attendance_exception: false,
      }));
      if (!input.search) return rows;
      const needle = input.search.toUpperCase();
      return rows.filter((row: any) => [row.labour_code, row.labour_name, row.contractor_name, row.category].some((value) => String(value || "").toUpperCase().includes(needle)));
    }
  }
  let attendanceQuery = access.admin
    .from("labour_attendance")
    .select(`
      *,
      labour_workers(id, labour_code, worker_name)
    `)
    .in("period_id", periodIds)
    .order("attendance_date", { ascending: true });
  if (input.workDate) attendanceQuery = attendanceQuery.eq("attendance_date", input.workDate);
  const { data: fetchedAttendanceRows, error: attendanceError } = await attendanceQuery;
  if (attendanceError) throw attendanceError;
  const eligibleWorkersByDate = new Map<string, Set<string>>();
  for (const attendanceDate of new Set((fetchedAttendanceRows || []).map((row: any) => dateText(row.attendance_date)).filter(Boolean) as string[])) {
    const eligibleDeployments = await loadEligibleDeployments(access, {
      organizationId: input.organizationId,
      companyId: input.companyId,
      siteId: input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate,
    });
    eligibleWorkersByDate.set(attendanceDate, new Set(eligibleDeployments.map((deployment: any) => deployment.labour_worker_id)));
  }
  const attendanceRows = (fetchedAttendanceRows || []).filter((row: any) => {
    const attendanceDate = dateText(row.attendance_date);
    return Boolean(attendanceDate && eligibleWorkersByDate.get(attendanceDate)?.has(row.labour_worker_id));
  });
  const deploymentIds = Array.from(new Set((attendanceRows || []).map((row: any) => row.deployment_id).filter(Boolean)));
  const { data: deployments, error: deploymentError } = deploymentIds.length
    ? await access.admin
        .from("labour_deployments")
        .select("id, contractor_profile_id, labour_trade_id, trade, wage_rate, labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
        .in("id", deploymentIds)
    : { data: [], error: null };
  if (deploymentError) throw deploymentError;
  const contractorIds = Array.from(new Set([
    ...(attendanceRows || []).map((row: any) => row.contractor_profile_id),
    ...(deployments || []).map((deployment: any) => deployment.contractor_profile_id),
    ...enrichedPeriods.map((period: any) => period.contractor_profile_id),
  ].filter(Boolean)));
  const { data: contractors, error: contractorError } = contractorIds.length
    ? await access.admin
        .from("labour_contractor_profiles")
        .select("id, contractor_code, vendors(vendor_name)")
        .in("id", contractorIds)
    : { data: [], error: null };
  if (contractorError) throw contractorError;
  const tradeIds = Array.from(new Set((deployments || []).map((deployment: any) => deployment.labour_trade_id).filter(Boolean)));
  const { data: trades, error: tradeError } = tradeIds.length
    ? await access.admin.from("labour_trades").select("id, trade_name, trade_code").in("id", tradeIds)
    : { data: [], error: null };
  if (tradeError) throw tradeError;
  const deploymentById = new Map<string, any>((deployments || []).map((deployment: any) => [deployment.id, deployment]));
  const contractorById = new Map<string, any>((contractors || []).map((contractor: any) => [contractor.id, contractor]));
  const tradeById = new Map<string, any>((trades || []).map((trade: any) => [trade.id, trade]));
  const rowsByPeriod = new Map<string, any[]>();
  for (const row of attendanceRows || []) {
    rowsByPeriod.set(row.period_id, [...(rowsByPeriod.get(row.period_id) || []), row]);
  }
  if (input.workDate) {
    const primaryPeriod = enrichedPeriods[0];
    const attendanceByWorker = new Map<string, any>((attendanceRows || []).map((attendance: any) => [attendance.labour_worker_id, attendance]));
    const eligibleDeployments = await loadEligibleDeployments(access, {
      organizationId: input.organizationId,
      companyId: input.companyId,
      siteId: input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate: input.workDate,
    });
    const flattened = eligibleDeployments.flatMap((deployment: any) => {
      const period = primaryPeriod;
      if (!period) return [];
      const status = standardDateStatus(period, input.workDate, true);
      if (requestedStatus && status !== requestedStatus) return [];
      const attendance = attendanceByWorker.get(deployment.labour_worker_id) || null;
      const worker = Array.isArray(deployment.labour_workers) ? deployment.labour_workers[0] : deployment.labour_workers;
      if (!worker?.id) return [];
      const trade: any = deployment.labour_trade_id ? tradeById.get(deployment.labour_trade_id) : null;
      const contractorProfile = contractorById.get(attendance?.contractor_profile_id)
        || contractorById.get(deployment.contractor_profile_id)
        || deployment.labour_contractor_profiles
        || period.labour_contractor_profiles;
      const contractorName = contractorProfile?.vendors?.vendor_name || contractorProfile?.contractor_code || "-";
      const firstHalfPresent = attendance ? attendance.first_half_present : null;
      const secondHalfPresent = attendance ? attendance.second_half_present : null;
      return [{
        id: attendance?.id ? `${period.id}:${attendance.id}` : `${period.id}:draft:${deployment.labour_worker_id}`,
        submission_id: period.id,
        attendance_period_id: period.id,
        company_id: period.company_id,
        site_id: period.site_id,
        contractor_profile_id: attendance?.contractor_profile_id || deployment.contractor_profile_id || period.contractor_profile_id || null,
        company_name: period.companies?.company_name || "-",
        site_name: period.sites?.site_name || "-",
        contractor_name: contractorName,
        period_month: period.period_month,
        work_date: input.workDate,
        labour_worker_id: deployment.labour_worker_id,
        labour_code: worker.labour_code || "-",
        labour_name: worker.worker_name || "-",
        category: trade?.trade_name || deployment.trade || "-",
        daily_rate: deployment.wage_rate ?? null,
        daily_rate_label: rupeeRateLabel(deployment.wage_rate),
        first_half_present: firstHalfPresent,
        second_half_present: secondHalfPresent,
        overtime_minutes: attendance ? Number(attendance.overtime_minutes || attendance.approved_overtime_minutes || 0) : 0,
        bonus_minutes: attendance ? Number(attendance.bonus_minutes || 0) : 0,
        remarks: attendance?.remarks || null,
        submitted_by_name: period.submitted_by_name,
        submitted_by_email: period.submitted_by_email,
        submitted_at: period.submitted_at,
        status: attendance?.status || "draft",
        register_status: status,
        attendance_exception: firstHalfPresent !== true || secondHalfPresent !== true || Number(attendance?.overtime_minutes || attendance?.approved_overtime_minutes || 0) > 0 || Number(attendance?.bonus_minutes || 0) > 0,
      }];
    });
    const realRows = flattened.filter((row: any) => row.labour_worker_id && row.labour_code && row.labour_name);
    if (!input.search) return realRows;
    const needle = input.search.toUpperCase();
    return realRows.filter((row: any) => [row.labour_code, row.labour_name, row.contractor_name, row.category, row.status, row.submitted_by_name, row.submitted_by_email]
      .some((value) => String(value || "").toUpperCase().includes(needle)));
  }
  const flattened = enrichedPeriods.flatMap((period: any) => {
    const rows = rowsByPeriod.get(period.id) || [];
    if (!rows.length) return [];
    return rows.flatMap((attendance: any) => {
      const status = standardDateStatus(period, attendance.attendance_date || input.workDate, true);
      if (requestedStatus && status !== requestedStatus) return [];
      const deployment: any = deploymentById.get(attendance.deployment_id);
      const trade: any = deployment?.labour_trade_id ? tradeById.get(deployment.labour_trade_id) : null;
      const contractorProfile = contractorById.get(attendance.contractor_profile_id)
        || contractorById.get(deployment?.contractor_profile_id)
        || period.labour_contractor_profiles;
      const contractorName = contractorProfile?.vendors?.vendor_name || contractorProfile?.contractor_code || "-";
      return [{
        id: `${period.id}:${attendance.id}`,
        submission_id: period.id,
        attendance_period_id: period.id,
        company_id: period.company_id,
        site_id: period.site_id,
        contractor_profile_id: attendance.contractor_profile_id || deployment?.contractor_profile_id || period.contractor_profile_id || null,
        company_name: period.companies?.company_name || "-",
        site_name: period.sites?.site_name || "-",
        contractor_name: contractorName,
        period_month: period.period_month,
        work_date: attendance.attendance_date || input.workDate || period.period_month,
        labour_worker_id: attendance.labour_worker_id,
        labour_code: attendance.labour_workers?.labour_code || "-",
        labour_name: attendance.labour_workers?.worker_name || "-",
        category: trade?.trade_name || deployment?.trade || "-",
        daily_rate: deployment?.wage_rate ?? null,
        daily_rate_label: rupeeRateLabel(deployment?.wage_rate),
        first_half_present: attendance.first_half_present,
        second_half_present: attendance.second_half_present,
        overtime_minutes: Number(attendance.overtime_minutes || attendance.approved_overtime_minutes || 0),
        bonus_minutes: Number(attendance.bonus_minutes || 0),
        remarks: attendance.remarks || null,
        submitted_by_name: period.submitted_by_name,
        submitted_by_email: period.submitted_by_email,
        submitted_at: period.submitted_at,
        status,
        attendance_exception: attendance.first_half_present === null || attendance.first_half_present === undefined || attendance.second_half_present === null || attendance.second_half_present === undefined || Number(attendance.overtime_minutes || attendance.approved_overtime_minutes || 0) > 0 || Number(attendance.bonus_minutes || 0) > 0,
      }];
    });
  });
  const realRows = flattened.filter((row: any) => row.labour_worker_id && row.labour_code && row.labour_name);
  if (!input.search) return realRows;
  const needle = input.search.toUpperCase();
  return realRows.filter((row: any) => [row.labour_code, row.labour_name, row.contractor_name, row.category, row.status, row.submitted_by_name, row.submitted_by_email]
    .some((value) => String(value || "").toUpperCase().includes(needle)));
}

async function loadStandardApprovalRegisters(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  workDate?: string | null;
  toDate?: string | null;
  status?: string | null;
  contractorProfileId?: string | null;
  search?: string | null;
}) {
  const periodMonthFrom = monthStart(input.workDate) || monthStart(new Date().toISOString().slice(0, 10));
  const periodMonthTo = monthStart(input.toDate) || periodMonthFrom;
  const requestedStatus = input.status === "final_approved" ? "finalized"
    : input.status === "sent_back_by_pm" || input.status === "sent_back_by_ho" ? "reopened"
    : input.status === "all" ? null
    : input.status === "submitted" || input.status === "finalized" || input.status === "reopened" || input.status === "draft" || input.status === "cancelled" ? input.status
    : "submitted";
  let periodQuery = access.admin
    .from("labour_attendance_periods")
    .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .gte("period_month", periodMonthFrom)
    .lte("period_month", periodMonthTo)
    .eq("originating_attendance_system", "standard")
    .order("submitted_at", { ascending: false });
  if (input.contractorProfileId) periodQuery = periodQuery.eq("contractor_profile_id", input.contractorProfileId);
  periodQuery = applyCompanySiteScope(periodQuery, access.assignments);
  if (!periodQuery) return [];
  const { data: periods, error } = await periodQuery;
  if (error) throw error;
  const enrichedPeriods = await enrichStandardSubmitterSnapshots(access, periods || []);
  const periodIds = enrichedPeriods.map((period: any) => period.id).filter(Boolean);
  if (!periodIds.length) return [];
  let submittedSnapshotQuery = access.admin
    .from("labour_attendance_submission_versions")
    .select("*")
    .in("period_id", periodIds)
    .eq("status", "submitted")
    .order("submission_version", { ascending: false });
  if (input.workDate) submittedSnapshotQuery = submittedSnapshotQuery.gte("attendance_date", input.workDate);
  if (input.toDate) submittedSnapshotQuery = submittedSnapshotQuery.lte("attendance_date", input.toDate);
  const { data: submittedSnapshots, error: submittedSnapshotError } = await submittedSnapshotQuery;
  if (submittedSnapshotError && submittedSnapshotError.code !== "42P01") throw submittedSnapshotError;
  const snapshotsByDate = new Map<string, any[]>();
  for (const snapshot of submittedSnapshots || []) {
    const date = dateText(snapshot.attendance_date);
    if (!date) continue;
    const current = snapshotsByDate.get(date) || [];
    if (!current.some((item: any) => item.period_id === snapshot.period_id)) current.push(snapshot);
    snapshotsByDate.set(date, current);
  }
  const periodByIdForSnapshots = new Map<string, any>(enrichedPeriods.map((period: any) => [period.id, period]));
  const attendanceRows: any[] = [];
  const attendancePageSize = 1000;
  for (let offset = 0; ; offset += attendancePageSize) {
    let attendanceQuery = access.admin
      .from("labour_attendance")
      .select("id, period_id, labour_worker_id, attendance_date, first_half_present, second_half_present, overtime_minutes, approved_overtime_minutes, bonus_minutes")
      .in("period_id", periodIds)
      .order("attendance_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + attendancePageSize - 1);
    if (input.workDate) attendanceQuery = attendanceQuery.gte("attendance_date", input.workDate);
    if (input.toDate) attendanceQuery = attendanceQuery.lte("attendance_date", input.toDate);
    const { data: page, error: attendanceError } = await attendanceQuery;
    if (attendanceError) throw attendanceError;
    attendanceRows.push(...(page || []));
    if (!page || page.length < attendancePageSize) break;
  }
  const rowsByPeriod = new Map<string, any[]>();
  for (const row of attendanceRows || []) {
    rowsByPeriod.set(row.period_id, [...(rowsByPeriod.get(row.period_id) || []), row]);
  }
  const groups = new Map<string, { periods: any[]; rows: any[]; workDate: string }>();
  for (const period of enrichedPeriods) {
    for (const attendance of rowsByPeriod.get(period.id) || []) {
      const workDate = dateText(attendance.attendance_date);
      if (!workDate) continue;
      const key = [period.organization_id, period.company_id, period.site_id, workDate].join(":");
      const current = groups.get(key) || { periods: [], rows: [], workDate };
      if (!current.periods.some((item: any) => item.id === period.id)) current.periods.push(period);
      current.rows.push(attendance);
      groups.set(key, current);
    }
  }
  const snapshotRegisters = Array.from(snapshotsByDate.entries()).map(([workDate, snapshots]) =>
    compactStandardSnapshotAggregate(
      snapshots.map((snapshot: any) => periodByIdForSnapshots.get(snapshot.period_id)).filter(Boolean),
      snapshots,
      workDate,
    )
  );
  const snapshotDates = new Set(snapshotRegisters.map((register: any) => register.work_date));
  for (const [key, group] of groups) {
    if (snapshotDates.has(group.workDate)) groups.delete(key);
  }
  for (const group of groups.values()) {
    const eligibleDeployments = await loadEligibleDeployments(access, {
      organizationId: group.periods[0]?.organization_id || input.organizationId,
      companyId: group.periods[0]?.company_id || input.companyId,
      siteId: group.periods[0]?.site_id || input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate: group.workDate,
    });
    const eligibleWorkerIds = new Set(eligibleDeployments.map((deployment: any) => deployment.labour_worker_id));
    group.rows = group.rows.filter((attendance: any) => eligibleWorkerIds.has(attendance.labour_worker_id));
  }
  let registers = [...snapshotRegisters, ...Array.from(groups.values()).map((group) => {
      // Submission snapshots remain the source for historical detail, but the
      // current approval register's status comes from the date-level period state.
      return compactStandardSiteRegister(group.periods, group.rows, group.workDate);
    })]
    .filter((register: any) => !requestedStatus || register.status === requestedStatus);
  if (input.contractorProfileId) {
    const allowedPeriodIds = new Set(enrichedPeriods.filter((period: any) => period.contractor_profile_id === input.contractorProfileId).map((period: any) => period.id));
    registers = registers.filter((register: any) => register.period_ids?.some((periodId: string) => allowedPeriodIds.has(periodId)));
  }
  if (input.search) {
    const needle = input.search.toUpperCase();
    registers = registers.filter((row: any) => [row.company_name, row.site_name, row.contractor_name, row.status, row.submitted_by_name, row.submitted_by_email]
      .some((value) => String(value || "").toUpperCase().includes(needle)));
  }
  return registers;
}

async function loadStandardMonthlyRegister(access: any, input: {
  organizationId: string;
  companyId: string;
  siteId: string;
  month: string;
  status?: string | null;
  contractorProfileId?: string | null;
  category?: string | null;
  attendanceStatus?: string | null;
  search?: string | null;
}) {
  const days = daysInMonth(input.month);
  const fromDate = `${input.month}-01`;
  const toDate = `${input.month}-${String(days).padStart(2, "0")}`;
  const requestedStatus = input.status === "all" ? null
    : input.status === "submitted" || input.status === "finalized" || input.status === "reopened" || input.status === "cancelled" ? input.status
    : "finalized";
  let periodQuery = access.admin
    .from("labour_attendance_periods")
    .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
    .eq("organization_id", input.organizationId)
    .eq("company_id", input.companyId)
    .eq("site_id", input.siteId)
    .eq("period_month", `${input.month}-01`)
    .eq("originating_attendance_system", "standard");
  if (input.contractorProfileId) periodQuery = periodQuery.eq("contractor_profile_id", input.contractorProfileId);
  periodQuery = applyCompanySiteScope(periodQuery, access.assignments);
  if (!periodQuery) return { rows: [], days, contractors: [], categories: [] };
  const { data: periods, error: periodError } = await periodQuery;
  if (periodError) throw periodError;
  const enrichedPeriods = await enrichStandardSubmitterSnapshots(access, periods || []);
  const periodIds = enrichedPeriods.map((period: any) => period.id).filter(Boolean);
  const contractors = Array.from(new Map(enrichedPeriods.map((period: any) => [
    period.contractor_profile_id || "",
    {
      id: period.contractor_profile_id || "",
      name: period.labour_contractor_profiles?.vendors?.vendor_name || period.labour_contractor_profiles?.contractor_code || "All Contractors",
    },
  ])).values()).filter((item: any) => item.id);
  if (!periodIds.length) return { rows: [], days, contractors, categories: [] };
  const attendanceRows: any[] = [];
  const attendancePageSize = 1000;
  for (let offset = 0; ; offset += attendancePageSize) {
    const { data: page, error: attendanceError } = await access.admin
      .from("labour_attendance")
      .select("id, period_id, labour_worker_id, deployment_id, attendance_date, first_half_present, second_half_present, overtime_minutes, approved_overtime_minutes, bonus_minutes, labour_workers(id, labour_code, worker_name)")
      .in("period_id", periodIds)
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate)
      .order("attendance_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + attendancePageSize - 1);
    if (attendanceError) throw attendanceError;
    attendanceRows.push(...(page || []));
    if (!page || page.length < attendancePageSize) break;
  }
  const eligibleWorkersByDate = new Map<string, Set<string>>();
  for (const attendanceDate of new Set(attendanceRows.map((row: any) => dateText(row.attendance_date)).filter(Boolean) as string[])) {
    const eligibleDeployments = await loadEligibleDeployments(access, {
      organizationId: input.organizationId,
      companyId: input.companyId,
      siteId: input.siteId,
      contractorProfileId: input.contractorProfileId || null,
      attendanceDate,
    });
    eligibleWorkersByDate.set(attendanceDate, new Set(eligibleDeployments.map((deployment: any) => deployment.labour_worker_id)));
  }
  const eligibleAttendanceRows = attendanceRows.filter((row: any) => {
    const attendanceDate = dateText(row.attendance_date);
    return Boolean(attendanceDate && eligibleWorkersByDate.get(attendanceDate)?.has(row.labour_worker_id));
  });
  attendanceRows.splice(0, attendanceRows.length, ...eligibleAttendanceRows);
  const deploymentIds = Array.from(new Set((attendanceRows || []).map((row: any) => row.deployment_id).filter(Boolean)));
  const { data: deployments, error: deploymentError } = deploymentIds.length
    ? await access.admin
        .from("labour_deployments")
        .select("id, contractor_profile_id, labour_trade_id, trade, wage_rate, labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
        .in("id", deploymentIds)
    : { data: [], error: null };
  if (deploymentError) throw deploymentError;
  const tradeIds = Array.from(new Set((deployments || []).map((deployment: any) => deployment.labour_trade_id).filter(Boolean)));
  const { data: trades, error: tradeError } = tradeIds.length
    ? await access.admin.from("labour_trades").select("id, trade_name, trade_code").in("id", tradeIds)
    : { data: [], error: null };
  if (tradeError) throw tradeError;
  const deploymentById = new Map<string, any>((deployments || []).map((deployment: any) => [deployment.id, deployment]));
  const tradeById = new Map<string, any>((trades || []).map((trade: any) => [trade.id, trade]));
  const categories = Array.from(new Set((deployments || []).map((deployment: any) => {
    const trade: any = deployment.labour_trade_id ? tradeById.get(deployment.labour_trade_id) : null;
    return trade?.trade_name || deployment.trade || "";
  }).filter(Boolean))).sort();
  const periodById = new Map<string, any>(enrichedPeriods.map((period: any) => [period.id, period]));
  const workers = new Map<string, any>();
  for (const attendance of attendanceRows || []) {
    if (!attendance.labour_worker_id) continue;
    const period: any = periodById.get(attendance.period_id);
    const statusMatches = standardDateStatusMatches(period, attendance.attendance_date, requestedStatus, true);
    if (!statusMatches) continue;
    const deployment: any = deploymentById.get(attendance.deployment_id);
    const trade: any = deployment?.labour_trade_id ? tradeById.get(deployment.labour_trade_id) : null;
    const contractorName = deployment?.labour_contractor_profiles?.vendors?.vendor_name
      || period?.labour_contractor_profiles?.vendors?.vendor_name
      || deployment?.labour_contractor_profiles?.contractor_code
      || period?.labour_contractor_profiles?.contractor_code
      || "-";
    const category = trade?.trade_name || deployment?.trade || "-";
    const current = workers.get(attendance.labour_worker_id) || {
      labour_worker_id: attendance.labour_worker_id,
      labour_code: attendance.labour_workers?.labour_code || "-",
      labour_name: attendance.labour_workers?.worker_name || "-",
      contractor_profile_id: deployment?.contractor_profile_id || period?.contractor_profile_id || "",
      contractor_name: contractorName,
      category,
      days: {},
      rate_values: new Set<string>(),
      present: 0,
      absent: 0,
      half_day: 0,
      total_ot_minutes: 0,
      total_bonus_minutes: 0,
    };
    const day = String(Number(String(attendance.attendance_date || "").slice(8, 10)));
    const code = labourDailyCode(attendance);
    current.days[day] = code;
    if (deployment?.wage_rate !== null && deployment?.wage_rate !== undefined && deployment?.wage_rate !== "") current.rate_values.add(String(Number(deployment.wage_rate)));
    if (code === "P") current.present += 1;
    if (code === "A") current.absent += 1;
    if (code === "HD") current.half_day += 1;
    current.total_ot_minutes += Number(attendance.overtime_minutes || attendance.approved_overtime_minutes || 0);
    current.total_bonus_minutes += Number(attendance.bonus_minutes || 0);
    workers.set(attendance.labour_worker_id, current);
  }
  let rows = Array.from(workers.values()).map((row: any) => {
    const { rate_values: rateValues, ...rest } = row;
    return {
      ...rest,
      daily_rate_label: rateValues.size > 1 ? "Multiple Rates" : rateValues.size === 1 ? rupeeRateLabel(Array.from(rateValues)[0]) : "-",
      ot_hours: numericHours(row.total_ot_minutes),
      bonus_hours: numericHours(row.total_bonus_minutes),
    };
  });
  if (input.category) rows = rows.filter((row: any) => row.category === input.category);
  if (input.attendanceStatus && input.attendanceStatus !== "all") {
    rows = rows.filter((row: any) => Object.values(row.days || {}).includes(input.attendanceStatus));
  }
  if (input.search) {
    const needle = input.search.toUpperCase();
    rows = rows.filter((row: any) => [row.labour_code, row.labour_name, row.contractor_name, row.category].some((value) => String(value || "").toUpperCase().includes(needle)));
  }
  rows.sort((a: any, b: any) => String(a.labour_name || "").localeCompare(String(b.labour_name || "")) || String(a.labour_code || "").localeCompare(String(b.labour_code || "")));
  return { rows, days, contractors, categories };
}

async function enrichSubmissionForReview(access: any, submission: any) {
  if (submission.status === "final_approved") return submission;
  if (!snapshotNeedsApprovalDetail(submission.snapshot) && submission.status !== "final_approved") return submission;
  const context = {
    organizationId: submission.organization_id,
    companyId: submission.company_id,
    siteId: submission.site_id,
    workDate: submission.work_date,
    contractorProfileId: submission.contractor_profile_id,
    engineerEmployeeId: submission.engineer_employee_id || text(submission.snapshot?.engineer_employee_id),
    engineerUserId: submission.engineer_user_id || text(submission.snapshot?.engineer_user_id),
  };
  const liveData = await loadPackageData(access, context);
  return { ...submission, snapshot: buildSnapshot(liveData) };
}

async function insertEvent(access: any, submission: any, action: string, previousStatus: string | null, snapshot: any, reason?: string | null, remarks?: string | null) {
  const { error } = await access.admin.from("labour_daily_submission_events").insert({
    submission_id: submission.id,
    organization_id: submission.organization_id,
    company_id: submission.company_id,
    site_id: submission.site_id,
    contractor_profile_id: submission.contractor_profile_id,
    engineer_employee_id: submission.engineer_employee_id || text(submission.snapshot?.engineer_employee_id),
    engineer_user_id: submission.engineer_user_id || text(submission.snapshot?.engineer_user_id),
    work_date: submission.work_date,
    submission_version: submission.submission_version,
    action,
    previous_status: previousStatus,
    new_status: submission.status,
    reason: reason || null,
    remarks: remarks || null,
    snapshot,
    ...actorFields(access.auth, "created"),
  });
  if (error) throw error;
}

async function updateSubmittedWorkLogsForSubmission(access: any, submission: any, status: string, now: string) {
  const engineerEmployeeId = submission.engineer_employee_id || text(submission.snapshot?.engineer_employee_id);
  let query = access.admin
    .from("labour_daily_work_logs")
    .update({ status, updated_at: now, ...actorFields(access.auth, "updated") })
    .eq("organization_id", submission.organization_id)
    .eq("company_id", submission.company_id)
    .eq("site_id", submission.site_id)
    .eq("contractor_profile_id", submission.contractor_profile_id)
    .eq("work_date", submission.work_date)
    .eq("status", "submitted");
  if (engineerEmployeeId) {
    const { data: groups, error: groupError } = await access.admin
      .from("labour_work_groups")
      .select("id")
      .eq("organization_id", submission.organization_id)
      .eq("company_id", submission.company_id)
      .eq("site_id", submission.site_id)
      .eq("contractor_profile_id", submission.contractor_profile_id)
      .eq("work_date", submission.work_date)
      .eq("engineer_employee_id", engineerEmployeeId)
      .eq("group_type", "engineer_group");
    if (groupError) throw groupError;
    const groupIds = (groups || []).map((group: any) => group.id).filter(Boolean);
    if (!groupIds.length) return;
    query = query.in("work_group_id", groupIds);
  }
  const { error } = await query;
  if (error) throw error;
}

async function auditTransition(access: any, request: Request, submission: any, action: ErpAuditAction, description: string, oldValues: any, newValues: any) {
  await audit(access, request, {
    moduleCode: "labour_daily_submission",
    action,
    entityType: "labour_daily_submission",
    recordId: submission.id,
    organizationId: submission.organization_id,
    companyId: submission.company_id,
    siteId: submission.site_id,
    description,
    oldValues,
    newValues,
  });
}

export async function loadStandardPeriod(access: any, id: string) {
  let query = access.admin.from("labour_attendance_periods").select("*").eq("id", id);
  if (access.organizationScope !== null) query = query.in("organization_id", access.organizationScope);
  query = applyCompanySiteScope(query, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadStandardPeriods(access: any, ids: string[]) {
  if (!ids.length) return [];
  let query = access.admin.from("labour_attendance_periods").select("*").in("id", ids);
  if (access.organizationScope !== null) query = query.in("organization_id", access.organizationScope);
  query = applyCompanySiteScope(query, access.assignments);
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function transitionStandardPeriod(access: any, request: Request, payload: any, action: string) {
  const explicitIds = Array.isArray(payload.period_ids) ? payload.period_ids.map((item: unknown) => text(item)).filter(Boolean) : [];
  const id = text(payload.id);
  const periodIds = Array.from(new Set((explicitIds.length ? explicitIds : [id]).filter(Boolean))) as string[];
  if (!periodIds.length) return jsonError("Attendance period is required.");
  const periods = await loadStandardPeriods(access, periodIds);
  if (periods.length !== periodIds.length) return jsonError("One or more attendance periods were not found.", 404);
  const first = periods[0];
  const sameRegister = periods.every((period: any) =>
    period.organization_id === first.organization_id &&
    period.company_id === first.company_id &&
    period.site_id === first.site_id &&
    period.period_month === first.period_month
  );
  if (!sameRegister) return jsonError("Selected attendance periods do not belong to the same site register.", 400);
  for (const period of periods) {
    const workflow = originatingAttendanceSystem(period.originating_attendance_system);
    if (!workflow) return jsonError("This attendance period has no originating attendance workflow. Confirm the historical workflow before approving it.", 409);
    if (workflow !== "standard") return jsonError("This approval action is available only for Standard Attendance records.", 403);
  }
  const workDate = dateText(payload.work_date || payload.attendance_date);
  if (!workDate) return jsonError("Attendance date is required.", 400);
  const { data: attendanceRows, error: attendanceError } = await access.admin
    .from("labour_attendance")
    .select("id, period_id")
    .in("period_id", periodIds)
    .eq("attendance_date", workDate);
  if (attendanceError) throw attendanceError;
  const periodIdsWithRows = new Set((attendanceRows || []).map((row: any) => row.period_id).filter(Boolean));
  if (!periodIdsWithRows.size) return jsonError("No attendance rows were found for the selected attendance date.", 404);
  if (periods.some((period: any) => !periodIdsWithRows.has(period.id))) return jsonError("Selected attendance periods do not all contain rows for this date register.", 400);
  const now = new Date().toISOString();
  if (action === "standard_approve") {
    for (const period of periods) {
      if (standardDateStatus(period, workDate, true) !== "submitted") return jsonError(`Attendance for ${workDate} is not submitted and cannot be approved.`);
      const patch = {
      summary: standardSummaryWithDateStatus(period, workDate, "finalized", { finalized_at: now, finalized_by: access.auth.user.id }),
      updated_at: now,
      ...actorFields(access.auth, "updated"),
      };
      const { error } = await access.admin.from("labour_attendance_periods").update(patch).eq("id", period.id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_attendance_approval",
        action: "approve",
        entityType: "labour_attendance_period",
        recordId: period.id,
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        description: "Approved standard labour attendance date.",
        oldValues: period,
        newValues: patch,
      });
    }
    return NextResponse.json({ updated: true, status: "finalized" });
  }
  if (action === "standard_send_back") {
    const reason = text(payload.reason);
    if (!reason || reason.length < 10) return jsonError("Enter a send-back reason of at least 10 characters.");
    if (periods.some((period: any) => standardDateStatus(period, workDate, true) !== "submitted")) return jsonError("Only submitted attendance periods can be sent back.");
    for (const period of periods) {
      const patch = {
      status: "reopened",
      summary: standardSummaryWithDateStatus(period, workDate, "reopened", { reopened_at: now, reopened_by: access.auth.user.id, reason }),
      transition_reason: reason,
      updated_at: now,
      reopened_at: now,
      ...actorFields(access.auth, "reopened" as any),
      ...actorFields(access.auth, "updated"),
      };
      const { error } = await access.admin.from("labour_attendance_periods").update(patch).eq("id", period.id);
      if (error) throw error;
      await audit(access, request, {
        moduleCode: "labour_attendance_approval",
        action: "reject",
        entityType: "labour_attendance_period",
        recordId: period.id,
        organizationId: period.organization_id,
        companyId: period.company_id,
        siteId: period.site_id,
        description: "Sent standard labour attendance period back for correction.",
        oldValues: period,
        newValues: patch,
      });
      const dateSummary = patch.summary?.date_statuses?.[workDate] || {};
      const recipientUserId = dateSummary.submitted_by || period.submitted_by;
      if (recipientUserId && recipientUserId !== access.auth.user.id) {
        const approverName = actorName(access) || access.auth.user.email || "Approver";
        const { data: site } = await access.admin.from("sites").select("site_name").eq("id", period.site_id).maybeSingle();
        const notification = await access.admin.from("user_notifications").insert({
          organization_id: period.organization_id,
          recipient_user_id: recipientUserId,
          notification_type: "labour_attendance_sent_back",
          title: "Labour Attendance Sent Back",
          message: `${site?.site_name || "Selected site"} attendance for ${workDate} was sent back by ${approverName}. Reason: ${reason}`,
          target_url: `/labour/attendance/daily?company_id=${encodeURIComponent(period.company_id)}&site_id=${encodeURIComponent(period.site_id)}&attendance_date=${encodeURIComponent(workDate)}`,
          related_entity_type: "labour_attendance_period",
          related_entity_id: period.id,
          created_by: access.auth.user.id,
          created_by_name: approverName,
        });
        if (notification.error) console.error("Labour attendance notification creation failed:", notification.error.message);
      }
    }
    return NextResponse.json({ updated: true, status: "reopened" });
  }
  return jsonError("Unsupported Standard Attendance approval action.");
}

function platformOwnerOnly(access: any) {
  return access.auth?.roleCodes?.includes("platform_owner");
}

function idsFromSnapshot(snapshot: any, key: string) {
  return Array.from(new Set((Array.isArray(snapshot?.[key]) ? snapshot[key] : [])
    .map((row: any) => text(row?.id))
    .filter(Boolean))) as string[];
}

function uniqueIds(values: unknown[]) {
  return Array.from(new Set(values.map((value) => text(value)).filter(Boolean))) as string[];
}

function standardAttendanceDeleteSummary(rows: any[]) {
  const realRows = rows.filter((row: any) => row.labour_worker_id);
  return {
    attendance_rows: realRows.length,
    present_count: realRows.filter((row: any) => row.first_half_present === true || row.second_half_present === true).length,
    absent_count: realRows.filter((row: any) => row.first_half_present === false && row.second_half_present === false).length,
    half_day_count: realRows.filter((row: any) =>
      (row.first_half_present === true && row.second_half_present === false) ||
      (row.first_half_present === false && row.second_half_present === true)
    ).length,
    total_overtime_minutes: realRows.reduce((sum: number, row: any) => sum + Number(row.overtime_minutes || row.approved_overtime_minutes || 0), 0),
    total_bonus_minutes: realRows.reduce((sum: number, row: any) => sum + Number(row.bonus_minutes || 0), 0),
  };
}

function standardSummaryAfterDateDelete(period: any, remainingRows: any[], workDate: string) {
  const summary = {
    ...(period?.summary && typeof period.summary === "object" && !Array.isArray(period.summary) ? period.summary : {}),
    ...standardAttendanceDeleteSummary(remainingRows),
  };
  if (summary.date_statuses && typeof summary.date_statuses === "object" && !Array.isArray(summary.date_statuses)) {
    const dateStatuses = { ...summary.date_statuses };
    delete dateStatuses[workDate];
    summary.date_statuses = dateStatuses;
  }
  return summary;
}

async function deleteStandardAttendanceRegister(access: any, request: Request, payload: any) {
  if (!platformOwnerOnly(access)) return jsonError("Only Platform Owner can delete attendance.", 403);
  const reason = text(payload.reason) || text(payload.deletion_reason);
  if (!reason || reason.length < 10) return jsonError("Deletion reason must be at least 10 characters.", 400);
  const workDate = dateText(payload.work_date || payload.attendance_date);
  if (!workDate) return jsonError("Attendance date is required.", 400);
  const explicitIds = Array.isArray(payload.period_ids) ? payload.period_ids.map((item: unknown) => text(item)).filter(Boolean) : [];
  const periodIds = Array.from(new Set(explicitIds.filter(Boolean))) as string[];
  if (!periodIds.length) return jsonError("Attendance period is required.");
  const periods = await loadStandardPeriods(access, periodIds);
  if (periods.length !== periodIds.length) return jsonError("One or more attendance periods were not found.", 404);
  const first = periods[0];
  const sameRegister = periods.every((period: any) =>
    period.organization_id === first.organization_id &&
    period.company_id === first.company_id &&
    period.site_id === first.site_id &&
    monthStart(period.period_month) === monthStart(workDate)
  );
  if (!sameRegister) return jsonError("Selected attendance periods do not belong to the same site register.", 400);
  if (periods.some((period: any) => originatingAttendanceSystem(period.originating_attendance_system) !== "standard")) {
    return jsonError("This delete action is available only for Standard Attendance records.", 403);
  }

  const { data: wagePeriods, error: wageError } = await access.admin
    .from("labour_wage_periods")
    .select("id, status, attendance_period_id")
    .in("attendance_period_id", periodIds);
  if (wageError) throw wageError;
  if ((wagePeriods || []).length) return jsonError("This attendance register is already used for labour wage or payment processing and cannot be deleted.", 409);

  const { data: attendanceRows, error: attendanceError } = await access.admin
    .from("labour_attendance")
    .select("*")
    .in("period_id", periodIds)
    .eq("attendance_date", workDate);
  if (attendanceError) throw attendanceError;
  const attendanceIds = (attendanceRows || []).map((row: any) => row.id).filter(Boolean);
  if (!attendanceIds.length) return jsonError("No attendance rows were found for the selected attendance date.", 404);

  for (const period of periods) {
    await audit(access, request, {
      moduleCode: "labour_attendance_approval",
      action: "delete",
      entityType: "labour_attendance_period",
      recordId: period.id,
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      description: "Platform Owner deleted standard labour Site + Date attendance register.",
      oldValues: {
        register_scope: "site_date",
        attendance_date: workDate,
        period_ids: periodIds,
        status: period.status,
        submitted_by: period.submitted_by,
        submitted_by_name: period.submitted_by_name,
        submitted_by_email: period.submitted_by_email,
        submitted_at: period.submitted_at,
        period,
        attendance_rows: (attendanceRows || []).filter((row: any) => row.period_id === period.id),
      },
      newValues: { reason, deleted_at: new Date().toISOString(), deleted_by: actorName(access) },
    });
  }

  if (attendanceIds.length) {
    const { error } = await access.admin.from("labour_attendance").delete().in("id", attendanceIds);
    if (error) throw error;
  }

  const { data: remainingRows, error: remainingError } = await access.admin
    .from("labour_attendance")
    .select("id, period_id, labour_worker_id, first_half_present, second_half_present, overtime_minutes, approved_overtime_minutes, bonus_minutes")
    .in("period_id", periodIds);
  if (remainingError) throw remainingError;
  const remainingByPeriod = new Map<string, any[]>();
  for (const row of remainingRows || []) {
    remainingByPeriod.set(row.period_id, [...(remainingByPeriod.get(row.period_id) || []), row]);
  }
  const emptyPeriodIds = periodIds.filter((periodId) => !(remainingByPeriod.get(periodId) || []).length);
  const preservedPeriodIds = periodIds.filter((periodId) => (remainingByPeriod.get(periodId) || []).length);
  if (emptyPeriodIds.length) {
    const { error: periodError } = await access.admin.from("labour_attendance_periods").delete().in("id", emptyPeriodIds);
    if (periodError) throw periodError;
  }
  for (const periodId of preservedPeriodIds) {
    const period = periods.find((item: any) => item.id === periodId);
    const { error } = await access.admin
      .from("labour_attendance_periods")
      .update({
        summary: standardSummaryAfterDateDelete(period, remainingByPeriod.get(periodId) || [], workDate),
        updated_at: new Date().toISOString(),
        ...actorFields(access.auth, "updated"),
      })
      .eq("id", periodId);
    if (error) throw error;
  }
  return NextResponse.json({
    deleted: true,
    attendance_date: workDate,
    deleted_attendance_rows: attendanceIds.length,
    deleted_periods: emptyPeriodIds.length,
    preserved_periods: preservedPeriodIds.length,
  });
}

async function deleteEngineerDailySubmission(access: any, request: Request, payload: any) {
  if (!platformOwnerOnly(access)) return jsonError("Only Platform Owner can delete attendance.", 403);
  const reason = text(payload.reason) || text(payload.deletion_reason);
  if (!reason || reason.length < 10) return jsonError("Deletion reason must be at least 10 characters.", 400);
  const id = text(payload.id);
  if (!id) return jsonError("Engineer Daily submission is required.");
  const submission = await loadSubmission(access, id);
  if (!submission) return jsonError("Engineer Daily submission was not found.", 404);
  const snapshot = submission.snapshot || {};
  const attendanceIds = idsFromSnapshot(snapshot, "attendance_rows");
  const workLogIds = idsFromSnapshot(snapshot, "work_logs");
  const groupIds = idsFromSnapshot(snapshot, "group_summary");
  const snapshotPhotoIds = uniqueIds([
    ...idsFromSnapshot(snapshot, "photos"),
    ...(Array.isArray(snapshot.work_logs) ? snapshot.work_logs.flatMap((log: any) => idsFromSnapshot(log, "photos")) : []),
  ]);

  const { data: attendanceRows, error: attendanceError } = attendanceIds.length
    ? await access.admin.from("labour_attendance").select("*").in("id", attendanceIds)
    : { data: [], error: null };
  if (attendanceError) throw attendanceError;
  const { data: workLogs, error: workLogError } = workLogIds.length
    ? await access.admin.from("labour_daily_work_logs").select("*").in("id", workLogIds)
    : { data: [], error: null };
  if (workLogError) throw workLogError;
  const { data: workGroups, error: groupError } = groupIds.length
    ? await access.admin.from("labour_work_groups").select("*").in("id", groupIds)
    : { data: [], error: null };
  if (groupError) throw groupError;
  const { data: groupMembers, error: memberError } = groupIds.length
    ? await access.admin.from("labour_work_group_members").select("*").in("work_group_id", groupIds)
    : { data: [], error: null };
  if (memberError) throw memberError;
  const { data: events, error: eventError } = await access.admin
    .from("labour_daily_submission_events")
    .select("*")
    .eq("submission_id", submission.id);
  if (eventError) throw eventError;

  const photoRowsById = new Map<string, any>();
  async function collectPhotos(query: any) {
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) photoRowsById.set(row.id, row);
  }
  if (snapshotPhotoIds.length) await collectPhotos(access.admin.from("labour_photo_evidence").select("*").in("id", snapshotPhotoIds));
  await collectPhotos(access.admin.from("labour_photo_evidence").select("*").eq("reference_id", submission.id));
  if (workLogIds.length) await collectPhotos(access.admin.from("labour_photo_evidence").select("*").in("work_log_id", workLogIds));
  if (groupIds.length) await collectPhotos(access.admin.from("labour_photo_evidence").select("*").in("work_group_id", groupIds));
  const photoEvidenceRows = Array.from(photoRowsById.values());
  const photoIds = photoEvidenceRows.map((row: any) => row.id).filter(Boolean);

  const month = `${String(submission.work_date || "").slice(0, 7)}-01`;
  const { data: wagePeriods, error: wageError } = await access.admin
    .from("labour_wage_periods")
    .select("id, status")
    .eq("organization_id", submission.organization_id)
    .eq("company_id", submission.company_id)
    .eq("site_id", submission.site_id)
    .eq("contractor_profile_id", submission.contractor_profile_id)
    .eq("period_month", month);
  if (wageError) throw wageError;
  const wagePeriodIds = (wagePeriods || []).map((row: any) => row.id).filter(Boolean);
  const exactWorkerIds = uniqueIds((attendanceRows || []).map((row: any) => row.labour_worker_id));
  const exactDeploymentIds = uniqueIds((attendanceRows || []).map((row: any) => row.deployment_id));
  if (wagePeriodIds.length && (exactWorkerIds.length || exactDeploymentIds.length)) {
    let wageLineQuery = access.admin.from("labour_wage_lines").select("id, wage_period_id, labour_worker_id, deployment_id").in("wage_period_id", wagePeriodIds);
    if (exactWorkerIds.length) wageLineQuery = wageLineQuery.in("labour_worker_id", exactWorkerIds);
    const { data: wageLines, error: wageLineError } = await wageLineQuery;
    if (wageLineError) throw wageLineError;
    const exactWageLines = (wageLines || []).filter((line: any) =>
      exactWorkerIds.includes(line.labour_worker_id) || (line.deployment_id && exactDeploymentIds.includes(line.deployment_id))
    );
    if (exactWageLines.length) return jsonError("This Engineer Daily submission is already used for labour wage or payment processing and cannot be deleted.", 409);
  } else if (wagePeriodIds.length) {
    return jsonError("This Engineer Daily submission may already be used for labour wage or payment processing and cannot be deleted.", 409);
  }

  await audit(access, request, {
    moduleCode: "labour_daily_submission",
    action: "delete",
    entityType: "labour_daily_submission",
    recordId: submission.id,
    organizationId: submission.organization_id,
    companyId: submission.company_id,
    siteId: submission.site_id,
    description: "Platform Owner deleted Engineer Daily Labour submission.",
    oldValues: {
      submission,
      attendance_rows: attendanceRows || [],
      work_logs: workLogs || [],
      work_groups: workGroups || [],
      group_members: groupMembers || [],
      photo_evidence: photoEvidenceRows,
      events: events || [],
    },
    newValues: { reason, deleted_at: new Date().toISOString(), deleted_by: actorName(access) },
  });

  if (photoIds.length) {
    const { error } = await access.admin.from("labour_photo_evidence").delete().in("id", photoIds);
    if (error) throw error;
  }
  const groupMemberIds = (groupMembers || []).map((row: any) => row.id).filter(Boolean);
  if (groupMemberIds.length) {
    const { error } = await access.admin.from("labour_work_group_members").delete().in("id", groupMemberIds);
    if (error) throw error;
  }
  if (workLogIds.length) {
    const { error } = await access.admin.from("labour_daily_work_logs").delete().in("id", workLogIds);
    if (error) throw error;
  }
  if (groupIds.length) {
    const { error } = await access.admin.from("labour_work_groups").delete().in("id", groupIds);
    if (error) throw error;
  }
  if (attendanceIds.length) {
    const { error } = await access.admin.from("labour_attendance").delete().in("id", attendanceIds);
    if (error) throw error;
  }
  const eventIds = (events || []).map((row: any) => row.id).filter(Boolean);
  if (eventIds.length) {
    const { error } = await access.admin.from("labour_daily_submission_events").delete().in("id", eventIds);
    if (error) throw error;
  }
  const { error: submissionError } = await access.admin.from("labour_daily_submissions").delete().eq("id", submission.id);
  if (submissionError) throw submissionError;
  return NextResponse.json({
    deleted: true,
    deleted_attendance_rows: attendanceIds.length,
    deleted_work_logs: workLogIds.length,
    deleted_work_groups: groupIds.length,
    deleted_group_members: groupMemberIds.length,
    deleted_photo_evidence: photoIds.length,
    deleted_events: eventIds.length,
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthlyMode = text(searchParams.get("view")) === "monthly";
    const access = await requireLabourPermission(request, monthlyMode ? "labour_attendance" : "labour_daily_submission", "view");
    if ("response" in access) return access.response;
    if (monthlyMode) {
      const requestedOrganizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
      const companyId = text(searchParams.get("company_id"));
      const siteId = text(searchParams.get("site_id"));
      const month = String(searchParams.get("month") || new Date().toISOString().slice(0, 7)).slice(0, 7);
      const resolved = await loadResolvedLabourSitePairs(access);
      const companies = resolved.companies.map((company: any) => ({
        id: company.id,
        name: company.company_name,
        company_name: company.company_name,
        organization_id: company.organization_id,
        status: company.status,
      }));
      const sites = resolved.sites.map((site: any) => ({
        id: site.id,
        name: site.site_name,
        site_name: site.site_name,
        site_code: site.site_code,
        company_id: site.company_id,
        organization_id: site.organization_id,
        status: site.status,
      }));
      if (!companyId || !siteId) {
        return NextResponse.json({
          rows: [],
          companies,
          sites,
          contractors: [],
          categories: [],
          days: daysInMonth(month),
          month,
          default_status: "submitted",
          mode: "standard_monthly",
          read_only: true,
        });
      }
      const scopeCheck = await validateLabourOperationalCompanySite(access, requestedOrganizationId, companyId, siteId);
      if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
      const result = await loadStandardMonthlyRegister(access, {
        organizationId: scopeCheck.organizationId,
        companyId,
        siteId,
        month,
        status: standardStatusFromFilter(text(searchParams.get("status")) || "submitted"),
        contractorProfileId: text(searchParams.get("contractor_profile_id")),
        category: text(searchParams.get("category")),
        attendanceStatus: text(searchParams.get("attendance_status")),
        search: text(searchParams.get("search")),
      });
      return NextResponse.json({
        ...result,
        companies,
        sites,
        month,
        default_status: "submitted",
        mode: "standard_monthly",
        read_only: true,
      });
    }
    const id = text(searchParams.get("id"));
    const standardIds = (searchParams.get("standard_ids") || "").split(",").map((item) => text(item)).filter(Boolean) as string[];
    if (id || standardIds.length) {
      const detailMode = text(searchParams.get("mode") || searchParams.get("workflow"));
      if (detailMode === "standard") {
        const standardPeriodId = standardIds[0] || id;
        if (!standardPeriodId) return jsonError("Attendance register not found.", 404);
        const period = await loadStandardPeriod(access, standardPeriodId);
        if (!period) return jsonError("Attendance register not found.", 404);
        const workflow = originatingAttendanceSystem(period.originating_attendance_system);
        if (workflow !== "standard") return jsonError("This approval register is not a Standard Attendance register.", 403);
        const requestedWorkDate = dateText(searchParams.get("work_date")) || null;
        const rows = await loadStandardApprovalRows(access, {
          organizationId: period.organization_id,
          companyId: period.company_id,
          siteId: period.site_id,
          periodId: standardIds.length ? null : period.id,
          periodIds: standardIds.length ? standardIds : null,
          workDate: requestedWorkDate,
          status: "all",
          contractorProfileId: null,
          search: text(searchParams.get("search")),
        });
        if (requestedWorkDate) {
          const mismatchedRow = rows.find((row: any) => dateText(row.work_date || row.attendance_date) !== requestedWorkDate);
          if (mismatchedRow) return jsonError("Attendance register rows do not match the selected attendance date.", 409);
        }
        const { data: periods, error: periodsError } = standardIds.length
          ? await access.admin
              .from("labour_attendance_periods")
              .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
              .in("id", standardIds)
          : { data: [period], error: null };
        if (periodsError) throw periodsError;
        const enrichedPeriods = await enrichStandardSubmitterSnapshots(access, periods || [period]);
        const periodIds = (periods || [period]).map((item: any) => item.id).filter(Boolean);
        const { data: supportingPdf, error: supportingPdfError } = requestedWorkDate && periodIds.length
          ? await access.admin
              .from("labour_attendance_date_documents")
              .select("id, original_file_name, mime_type, size_bytes, uploaded_at, uploaded_by_name, uploaded_by_email")
              .in("period_id", periodIds)
              .eq("attendance_date", requestedWorkDate)
              .eq("is_active", true)
              .order("uploaded_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null, error: null };
        if (supportingPdfError) throw supportingPdfError;
        return NextResponse.json({
          submission: { ...compactStandardSiteRegister(enrichedPeriods, rows, requestedWorkDate), supporting_pdf: publicStandardSupportingPdf(supportingPdf) },
          snapshot: { attendance_rows: rows },
          live: { attendance_rows: rows },
          events: [],
          mode: "standard",
          attendance_system: "standard",
        });
      }
      if (!id) return jsonError("Labour approval package not found.", 404);
      const submission = await loadSubmission(access, id);
      if (!submission) return jsonError("Labour approval package not found.", 404);
      const detailCanHo = hasPermission(access, "labour_daily_submission", "ho_approve") || hasPermission(access, "labour_daily_submission", "ho_send_back");
      const detailCanPm = hasPermission(access, "labour_daily_submission", "pm_approve") || hasPermission(access, "labour_daily_submission", "pm_send_back");
      if (access.organizationScope !== null && !access.organizationScope.includes(submission.organization_id)) return jsonError("Labour approval package not found.", 404);
      if (!(detailCanHo && !detailCanPm) && access.assignments.companyIds?.length && !access.assignments.companyIds.includes(submission.company_id)) return jsonError("Labour approval package not found.", 404);
      if (!(detailCanHo && !detailCanPm) && access.assignments.siteIds?.length && !access.assignments.siteIds.includes(submission.site_id)) return jsonError("Labour approval package not found.", 404);
      if (!await canAccessSubmissionStage(access, submission)) return jsonError("You cannot view Labour approval packages at this stage.", 403);
      const context = {
        organizationId: submission.organization_id,
        companyId: submission.company_id,
        siteId: submission.site_id,
        workDate: submission.work_date,
        contractorProfileId: submission.contractor_profile_id,
        engineerEmployeeId: submission.engineer_employee_id || text(submission.snapshot?.engineer_employee_id),
        engineerUserId: submission.engineer_user_id || text(submission.snapshot?.engineer_user_id),
      };
      const [liveData, eventsResult] = await Promise.all([
        loadPackageData(access, context),
        access.admin.from("labour_daily_submission_events").select("*").eq("submission_id", id).order("created_at", { ascending: false }),
      ]);
      if (eventsResult.error) throw eventsResult.error;
      const snapshot = submission.snapshot || buildSnapshot(liveData);
      const live = buildSnapshot(liveData);
      const engineerId = submission.engineer_employee_id || text(snapshot.engineer_employee_id);
      const { data: employees, error: employeeError } = engineerId
        ? await access.admin.from("hr_employees").select("id, employee_name").eq("id", engineerId)
        : { data: [], error: null };
      if (employeeError) throw employeeError;
      const employeeById = new Map((employees || []).map((employee: any) => [employee.id, employee]));
      return NextResponse.json({
        submission: compactSubmission({ ...submission, snapshot }, employeeById),
        snapshot: { ...snapshot, attendance_rows: flattenSubmissionForRegister({ ...submission, snapshot }, employeeById) },
        live,
        events: eventsResult.data || [],
      });
    }

    const status = text(searchParams.get("status"));
    const allowedStatuses = allowedApprovalStatuses(access);
    const canPm = hasPermission(access, "labour_daily_submission", "pm_approve") || hasPermission(access, "labour_daily_submission", "pm_send_back");
    const canHo = hasPermission(access, "labour_daily_submission", "ho_approve") || hasPermission(access, "labour_daily_submission", "ho_send_back");
    const canViewApproval = hasPermission(access, "labour_daily_submission", "view");
    const approvalOptions = await loadApprovalSiteOptions(access, canPm, canHo, canViewApproval);
    const requestedDate = dateText(searchParams.get("work_date"));
    const fromDate = requestedDate || dateText(searchParams.get("date_from"));
    const toDate = requestedDate || dateText(searchParams.get("date_to"));
    const currentPage = pageNumber(searchParams.get("page"));
    const perPage = pageSize(searchParams.get("page_size"));
    const search = text(searchParams.get("search"));
    const engineerFilter = text(searchParams.get("engineer_employee_id"));
    const groupFilter = text(searchParams.get("group_id"));
    const attendanceExceptionFilter = text(searchParams.get("attendance_exception"));
    const photoStatusFilter = text(searchParams.get("photo_status"));
    const companyFilter = text(searchParams.get("company_id"));
    const siteFilter = text(searchParams.get("site_id"));
    const contractorFilter = text(searchParams.get("contractor_profile_id"));
    const workflowFilter = text(searchParams.get("workflow") || searchParams.get("mode"));
    const metadataOnly = searchParams.get("metadata_only") === "true";

    if (!companyFilter || !siteFilter) {
      return NextResponse.json({
        rows: [],
        submissions: [],
        summary: {},
        pagination: { page: currentPage, page_size: perPage, total: 0, total_pages: 1 },
        sites: approvalOptions.sites,
        companies: approvalOptions.companies,
        contractors: [],
        engineers: [],
        groups: [],
        mode: null,
        attendance_system: null,
        default_status: canHo && !canPm ? "pending_ho_approval" : canPm ? "pending_pm_approval" : "all",
        can_pm: canPm,
        can_ho: canHo,
      });
    }

    const requestedOrganizationId = text(searchParams.get("organization_id")) || (Array.isArray(access.organizationScope) ? access.organizationScope[0] : null);
    const scopeCheck = await validateApprovalCompanySiteLookup(access, requestedOrganizationId, companyFilter, siteFilter);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);
    const system = await resolveSiteAttendanceSystem(access, { organizationId: scopeCheck.organizationId, companyId: companyFilter, siteId: siteFilter });
    if (!system.ok) return jsonError(system.message, 403);
    const approvalWorkflow = workflowFilter === "standard" || workflowFilter === "site_in_engineer"
      ? workflowFilter
      : system.attendanceSystem === "standard"
        ? "standard"
        : workflowFromApprovalStatus(status) || system.attendanceSystem;
    const effectiveStatus = approvalWorkflow === "standard" ? standardStatusFromFilter(status) : status;
    if (approvalWorkflow === "site_in_engineer" && allowedStatuses.size === 0) {
      return NextResponse.json({
        rows: [],
        submissions: [],
        summary: {},
        pagination: { page: currentPage, page_size: perPage, total: 0, total_pages: 1 },
        sites: approvalOptions.sites,
        companies: approvalOptions.companies,
        contractors: [],
        engineers: [],
        groups: [],
        mode: approvalWorkflow,
        attendance_system: approvalWorkflow,
        current_attendance_system: system.attendanceSystem,
        default_status: "all",
        can_pm: false,
        can_ho: false,
      });
    }
    if (metadataOnly) {
      return NextResponse.json({
        rows: [],
        submissions: [],
        summary: {},
        pagination: { page: currentPage, page_size: perPage, total: 0, total_pages: 1 },
        sites: approvalOptions.sites,
        companies: approvalOptions.companies,
        contractors: [],
        engineers: [],
        groups: [],
        mode: approvalWorkflow,
        attendance_system: approvalWorkflow,
        current_attendance_system: system.attendanceSystem,
        default_status: approvalWorkflow === "standard" ? "submitted" : canHo && !canPm ? "pending_ho_approval" : canPm ? "pending_pm_approval" : "all",
        can_pm: canPm,
        can_ho: canHo,
      });
    }
    if (approvalWorkflow === "standard") {
      const standardRegistersAll = await loadStandardApprovalRegisters(access, {
        organizationId: scopeCheck.organizationId,
        companyId: companyFilter,
        siteId: siteFilter,
        workDate: fromDate,
        toDate,
        status: effectiveStatus,
        contractorProfileId: contractorFilter,
        search,
      });
      let standardRegisters = standardRegistersAll;
      if (attendanceExceptionFilter === "incomplete") {
        standardRegisters = standardRegisters.filter((row: any) => Number(row.attendance_exceptions || 0) > 0);
      } else if (attendanceExceptionFilter === "absent") {
        standardRegisters = standardRegisters.filter((row: any) => Number(row.absent_count || 0) > 0);
      } else if (attendanceExceptionFilter === "ot") {
        standardRegisters = standardRegisters.filter((row: any) => Number(row.attendance_exceptions || 0) > 0);
      }
      const total = standardRegisters.length;
      const start = (currentPage - 1) * perPage;
      const registers = standardRegisters.slice(start, start + perPage);
      const contractors = Array.from(new Map(standardRegisters.map((row: any) => [row.contractor_profile_id || "all", { id: row.contractor_profile_id || "", name: row.contractor_name }])).values());
      return NextResponse.json({
        rows: [],
        submissions: registers,
        summary: standardSummaryCounts(standardRegisters),
        pagination: { page: currentPage, page_size: perPage, total, total_pages: Math.max(Math.ceil(total / perPage), 1) },
        sites: approvalOptions.sites,
        companies: approvalOptions.companies,
        contractors,
        engineers: [],
        groups: [],
        mode: "standard",
        attendance_system: "standard",
        current_attendance_system: system.attendanceSystem,
        default_status: "submitted",
        can_pm: canPm,
        can_ho: canHo,
      });
    }
    const requestedStatuses = approvalWorkflow === "site_in_engineer" ? engineerStatusesFromFilter(effectiveStatus, allowedStatuses) : [];
    if (approvalWorkflow === "site_in_engineer" && effectiveStatus && effectiveStatus !== "all" && !requestedStatuses.length) {
      return jsonError("You cannot view Labour approval packages at this stage.", 403);
    }
    let query = access.admin
      .from("labour_daily_submissions")
      .select("*, companies(company_name), sites(site_name), labour_contractor_profiles(id, contractor_code, vendors(vendor_name))")
      .in("status", requestedStatuses)
      .eq("originating_attendance_system", "site_in_engineer")
      .order("work_date", { ascending: false })
      .order("submitted_at", { ascending: false });
    if (fromDate) query = query.gte("work_date", fromDate);
    if (toDate) query = query.lte("work_date", toDate);
    if (companyFilter) query = query.eq("company_id", companyFilter);
    if (siteFilter) query = query.eq("site_id", siteFilter);
    if (contractorFilter) query = query.eq("contractor_profile_id", contractorFilter);
    if (engineerFilter) query = query.eq("engineer_employee_id", engineerFilter);
    if (access.organizationScope !== null) query = query.in("organization_id", access.organizationScope);
    if (!(canHo && !canPm) && access.assignments.companyIds?.length) query = query.in("company_id", access.assignments.companyIds);
    if (!(canHo && !canPm) && access.assignments.siteIds?.length) query = query.in("site_id", access.assignments.siteIds);
    const needsHoAssignment = !isGlobalOrSuperAdmin(access) && canHo && requestedStatuses.some((item) => ["pending_ho_approval", "sent_back_by_ho", "final_approved"].includes(item));
    if (needsHoAssignment) {
      const hoOrgIds = await assignedHoOrganizationIds(access);
      if (!hoOrgIds?.length) return NextResponse.json({ rows: [], submissions: [], sites: approvalOptions.sites, companies: approvalOptions.companies, default_status: "pending_ho_approval", can_pm: canPm, can_ho: canHo, mode: "site_in_engineer", attendance_system: "site_in_engineer" });
      query = query.in("organization_id", hoOrgIds);
    }
    const needsPmAssignment = !isGlobalOrSuperAdmin(access) && canPm && requestedStatuses.some((item) => item === "pending_pm_approval" || item === "sent_back_by_pm" || (!canHo && ["pending_ho_approval", "final_approved"].includes(item)));
    if (needsPmAssignment) {
      const pmSiteIds = await assignedPmSiteIds(access);
      if (!pmSiteIds?.length) return NextResponse.json({ rows: [], submissions: [], sites: approvalOptions.sites, companies: approvalOptions.companies, default_status: "pending_pm_approval", can_pm: canPm, can_ho: canHo, mode: "site_in_engineer", attendance_system: "site_in_engineer" });
      const requestedSiteId = text(searchParams.get("site_id"));
      if (requestedSiteId && !pmSiteIds.includes(requestedSiteId)) return jsonError("You are not assigned as PM for this Site.", 403);
      query = query.in("site_id", pmSiteIds);
    }
    const { data, error } = await query.limit(200);
    if (error) throw error;
    const enrichedSubmissions = await Promise.all((data || []).map((submission: any) => enrichSubmissionForReview(access, submission)));
    const default_status = canHo && !canPm ? "pending_ho_approval" : canPm ? "pending_pm_approval" : "all";
    const engineerIds = Array.from(new Set(enrichedSubmissions.map((row: any) => row.engineer_employee_id || text(row.snapshot?.engineer_employee_id)).filter(Boolean)));
    const { data: employees, error: employeeError } = engineerIds.length
      ? await access.admin.from("hr_employees").select("id, employee_name").in("id", engineerIds)
      : { data: [], error: null };
    if (employeeError) throw employeeError;
    const employeeById = new Map((employees || []).map((employee: any) => [employee.id, employee]));
    let registerRows = enrichedSubmissions.flatMap((row: any) => flattenSubmissionForRegister(row, employeeById));
    let submissionHeaders = enrichedSubmissions.map((row: any) => compactSubmission(row, employeeById));
    if (search) {
      const needle = search.toUpperCase();
      registerRows = registerRows.filter((row: any) => [row.engineer_name, row.contractor_name, row.company_name, row.site_name, row.status, row.submitted_by_name, row.submitted_by_email, row.labour_name, row.labour_code, row.category, row.group_name, row.work_description]
        .some((value) => String(value || "").toUpperCase().includes(needle)));
      submissionHeaders = submissionHeaders.filter((row: any) => [row.engineer_name, row.contractor_name, row.company_name, row.site_name, row.status, row.submitted_by_name, row.submitted_by_email]
        .some((value) => String(value || "").toUpperCase().includes(needle)));
    }
    if (groupFilter) {
      const matchingSubmissionIds = new Set(registerRows.filter((row: any) => row.group_id === groupFilter).map((row: any) => row.submission_id));
      registerRows = registerRows.filter((row: any) => row.group_id === groupFilter);
      submissionHeaders = submissionHeaders.filter((row: any) => matchingSubmissionIds.has(row.id));
    }
    if (attendanceExceptionFilter === "incomplete") {
      registerRows = registerRows.filter((row: any) => row.first_half_present === null || row.first_half_present === undefined || row.second_half_present === null || row.second_half_present === undefined);
    } else if (attendanceExceptionFilter === "absent") {
      registerRows = registerRows.filter((row: any) => row.first_half_present === false || row.second_half_present === false);
    } else if (attendanceExceptionFilter === "ot") {
      registerRows = registerRows.filter((row: any) => Number(row.overtime_minutes || 0) > 0);
    } else if (attendanceExceptionFilter === "bonus") {
      registerRows = registerRows.filter((row: any) => Number(row.bonus_minutes || 0) > 0);
    }
    if (photoStatusFilter === "with_photos") registerRows = registerRows.filter((row: any) => row.photo_count > 0);
    if (photoStatusFilter === "missing_photos") registerRows = registerRows.filter((row: any) => row.productive_photo_missing);
    if (attendanceExceptionFilter && attendanceExceptionFilter !== "all") {
      const matchingSubmissionIds = new Set(registerRows.map((row: any) => row.submission_id));
      submissionHeaders = submissionHeaders.filter((row: any) => matchingSubmissionIds.has(row.id));
    }
    if (photoStatusFilter && photoStatusFilter !== "all") {
      const matchingSubmissionIds = new Set(registerRows.map((row: any) => row.submission_id));
      submissionHeaders = submissionHeaders.filter((row: any) => matchingSubmissionIds.has(row.id));
    }
    const total = submissionHeaders.length;
    const start = (currentPage - 1) * perPage;
    const submissions = submissionHeaders.slice(start, start + perPage);
    const contractors = Array.from(new Map(registerRows.map((row: any) => [row.contractor_profile_id, { id: row.contractor_profile_id, name: row.contractor_name }])).values()).filter((item: any) => item.id);
    const engineers = Array.from(new Map(registerRows.map((row: any) => [row.engineer_employee_id, { id: row.engineer_employee_id, name: row.engineer_name }])).values()).filter((item: any) => item.id);
    const groups = Array.from(new Map(registerRows.map((row: any) => [row.group_id, { id: row.group_id, name: row.group_name }])).values()).filter((item: any) => item.id);
    return NextResponse.json({
      rows: [],
      submissions,
      summary: summaryCounts(registerRows),
      pagination: { page: currentPage, page_size: perPage, total, total_pages: Math.max(Math.ceil(total / perPage), 1) },
      sites: approvalOptions.sites,
      companies: approvalOptions.companies,
      contractors,
      engineers,
      groups,
      mode: "site_in_engineer",
      attendance_system: "site_in_engineer",
      current_attendance_system: system.attendanceSystem,
      default_status,
      can_pm: canPm,
      can_ho: canHo,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Labour approvals.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_daily_submission", "submit");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const context = await resolveContext(access, payload);
    if ("error" in context) return jsonError(context.error || "Selected context is not available.", context.status || 400);
    const packageData = await loadPackageData(access, context);
    const readyError = validateReadyForSubmit(packageData, context);
    if (readyError) return jsonError(readyError);
    const snapshot = { ...buildSnapshot(packageData), originating_attendance_system: "site_in_engineer" };
    let existingQuery = access.admin
      .from("labour_daily_submissions")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("site_id", context.siteId)
      .eq("contractor_profile_id", context.contractorProfileId)
      .eq("work_date", context.workDate);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (existing && !EDITABLE_STATUSES.includes(existing.status)) return jsonError("This Labour package is already locked for approval.", 403);
    const version = (existing?.submission_version || 0) + 1;
    const now = new Date().toISOString();
    const patch = {
      organization_id: context.organizationId,
      company_id: context.companyId,
      site_id: context.siteId,
      contractor_profile_id: context.contractorProfileId,
      originating_attendance_system: "site_in_engineer",
      work_date: context.workDate,
      status: "pending_pm_approval",
      submission_version: version,
      submitted_by: access.auth.user.id,
      submitted_by_name: actorName(access),
      submitted_by_email: access.auth.user.email || null,
      submitted_at: now,
      last_transition: existing ? "site_hr_resubmit" : "site_hr_submit",
      last_transition_at: now,
      snapshot,
      ...(existing ? actorFields(access.auth, "updated") : actorFields(access.auth, "created")),
      updated_at: now,
    };
    const { data: submission, error } = existing
      ? await access.admin.from("labour_daily_submissions").update(patch).eq("id", existing.id).select("*").single()
      : await access.admin.from("labour_daily_submissions").insert(patch).select("*").single();
    if (error) throw error;
    const { error: workSubmitError } = await access.admin.from("labour_daily_work_logs").update({ status: "submitted", submitted_by: access.auth.user.id, submitted_by_name: actorName(access), submitted_by_email: access.auth.user.email || null, submitted_at: now, updated_at: now, ...actorFields(access.auth, "updated") })
      .eq("organization_id", context.organizationId).eq("company_id", context.companyId).eq("site_id", context.siteId).eq("contractor_profile_id", context.contractorProfileId).eq("work_date", context.workDate).eq("status", "draft");
    if (workSubmitError) throw workSubmitError;
    await insertEvent(access, submission, existing ? "site_hr_resubmit" : "site_hr_submit", existing?.status || null, snapshot, null, text(payload.remarks));
    await auditTransition(access, request, submission, existing ? "update" : "create", existing ? "Resubmitted Labour daily package for PM approval." : "Submitted Labour daily package for PM approval.", existing, { status: "pending_pm_approval", submission_version: version });
    return NextResponse.json({ submission_id: submission.id, status: submission.status, submission_version: submission.submission_version });
  } catch (error: any) {
    return jsonError(error.message || "Failed to submit Labour package.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const action = text(payload.action);
    if (action === "standard_approve" || action === "standard_send_back") {
      const access = await requireLabourPermission(request, "labour_daily_submission", action === "standard_approve" ? "pm_approve" : "pm_send_back");
      if ("response" in access) return access.response;
      return transitionStandardPeriod(access, request, payload, action);
    }
    const permissionAction = action === "pm_approve" ? "pm_approve"
      : action === "pm_send_back" ? "pm_send_back"
      : action === "ho_approve" ? "ho_approve"
      : action === "ho_send_back" ? "ho_send_back"
      : null;
    if (!permissionAction) return jsonError("Unsupported Labour approval action.");
    const access = await requireLabourPermission(request, "labour_daily_submission", permissionAction);
    if ("response" in access) return access.response;
    const id = text(payload.id);
    if (!id) return jsonError("Labour approval package is required.");
    const submission = await loadSubmission(access, id);
    if (!submission) return jsonError("Labour approval package not found.", 404);
    const isHoAction = ["ho_approve", "ho_send_back"].includes(permissionAction);
    if (access.organizationScope !== null && !access.organizationScope.includes(submission.organization_id)) return jsonError("Labour approval package not found.", 404);
    if (!isHoAction && access.assignments.companyIds?.length && !access.assignments.companyIds.includes(submission.company_id)) return jsonError("Labour approval package not found.", 404);
    if (!isHoAction && access.assignments.siteIds?.length && !access.assignments.siteIds.includes(submission.site_id)) return jsonError("Labour approval package not found.", 404);
    if (["pm_approve", "pm_send_back"].includes(permissionAction) && !(await isAssignedMusterPm(access, {
      organizationId: submission.organization_id,
      companyId: submission.company_id,
      siteId: submission.site_id,
    }))) {
      return jsonError("You are not assigned as PM for this Site.", 403);
    }
    if (isHoAction && !(await isAssignedLabourHoHr(access, { organizationId: submission.organization_id }))) {
      return jsonError("You are not assigned as HO HR for this organization.", 403);
    }
    const reason = text(payload.reason);
    const remarks = text(payload.remarks);
    const now = new Date().toISOString();
    const previousStatus = submission.status;
    let nextStatus = previousStatus;
    const patch: any = { updated_at: now, last_transition: action, last_transition_at: now, ...actorFields(access.auth, "updated") };
    let auditAction: ErpAuditAction = "update";
    if (action === "pm_approve") {
      if (previousStatus !== "pending_pm_approval") return jsonError("PM can approve only packages pending PM approval.", 403);
      nextStatus = "pending_ho_approval";
      Object.assign(patch, { status: nextStatus, pm_approved_by: access.auth.user.id, pm_approved_by_name: actorName(access), pm_approved_by_email: access.auth.user.email || null, pm_approved_at: now, pm_remarks: remarks });
      auditAction = "approve";
    } else if (action === "pm_send_back") {
      if (previousStatus !== "pending_pm_approval") return jsonError("PM can send back only packages pending PM approval.", 403);
      if (!reason || reason.length < 10) return jsonError("Enter a send-back reason of at least 10 characters.");
      nextStatus = "sent_back_by_pm";
      Object.assign(patch, { status: nextStatus, pm_sent_back_by: access.auth.user.id, pm_sent_back_by_name: actorName(access), pm_sent_back_by_email: access.auth.user.email || null, pm_sent_back_at: now, pm_send_back_reason: reason });
      auditAction = "reject";
    } else if (action === "ho_approve") {
      if (previousStatus !== "pending_ho_approval") return jsonError("HO HR can final approve only after PM approval.", 403);
      nextStatus = "final_approved";
      Object.assign(patch, { status: nextStatus, ho_approved_by: access.auth.user.id, ho_approved_by_name: actorName(access), ho_approved_by_email: access.auth.user.email || null, ho_approved_at: now, ho_remarks: remarks, final_approved_at: now });
      auditAction = "approve";
    } else if (action === "ho_send_back") {
      if (previousStatus !== "pending_ho_approval") return jsonError("HO HR can send back only packages pending HO HR approval.", 403);
      if (!reason || reason.length < 10) return jsonError("Enter a send-back reason of at least 10 characters.");
      nextStatus = "sent_back_by_ho";
      Object.assign(patch, { status: nextStatus, ho_sent_back_by: access.auth.user.id, ho_sent_back_by_name: actorName(access), ho_sent_back_by_email: access.auth.user.email || null, ho_sent_back_at: now, ho_send_back_reason: reason });
      auditAction = "reject";
    }
    const { data: updated, error } = await access.admin.from("labour_daily_submissions").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    if (["sent_back_by_pm", "sent_back_by_ho"].includes(nextStatus)) {
      await updateSubmittedWorkLogsForSubmission(access, updated, "draft", now);
    } else if (nextStatus === "final_approved") {
      await updateSubmittedWorkLogsForSubmission(access, updated, "approved", now);
    }
    await insertEvent(access, updated, permissionAction, previousStatus, updated.snapshot || {}, reason, remarks);
    await auditTransition(access, request, updated, auditAction, `Labour approval transition: ${permissionAction}.`, { status: previousStatus }, { status: nextStatus, reason, remarks, submission_version: updated.submission_version });
    return NextResponse.json({ updated: true, status: nextStatus });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update Labour approval.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const mode = text(payload.mode);
    const access = await requireLabourPermission(request, "labour_daily_submission", "view");
    if ("response" in access) return access.response;
    if (mode === "standard") return deleteStandardAttendanceRegister(access, request, payload);
    if (mode === "site_in_engineer") return deleteEngineerDailySubmission(access, request, payload);
    return jsonError("Unsupported attendance delete mode.", 400);
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete attendance.", 500);
  }
}
