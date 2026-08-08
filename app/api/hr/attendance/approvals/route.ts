import { NextResponse } from "next/server";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES, datesForMonth } from "@/lib/hr/attendance";
import { applyOrganizationScope, isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  adminClient,
  canReviewEmployeeAttendancePeriod,
  hasAttendanceApprovalPermission,
  jsonError,
  loadActorAssignments,
  loadAttendanceRows,
  loadEligibleEmployees,
  requireAttendanceApprovalActor,
} from "../_shared";

const PENDING_APPROVAL_STATUSES = ["submitted", "level_1_approved", "level_2_approved"];

function periodStatusesFromFilter(value: string | null) {
  if (!value || value === "pending") return PENDING_APPROVAL_STATUSES;
  if (value === "approved") return ["finalized"];
  if (value === "sent_back") return ["reopened"];
  if (value === "all") return null;
  return PENDING_APPROVAL_STATUSES;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(`${month}T00:00:00Z`),
  );
}

function statusLabel(status: string) {
  if (status === "submitted") return "Pending Level 1";
  if (status === "level_1_approved") return "Pending Level 2";
  if (status === "level_2_approved") return "Pending Level 3";
  if (status === "finalized") return "Final Approved";
  return status.replace(/_/g, " ");
}

function currentLevelLabel(period: any) {
  const level = Number(period.current_approval_level || 0);
  return level > 0 ? `Level ${level} Approval` : "No approval pending";
}

function summarizeRows(employees: any[], rows: any[], month: string) {
  const expected = employees.length * datesForMonth(month).length;
  const summary = ATTENDANCE_STATUSES.reduce((acc: any, status) => {
    acc[status] = rows.filter((row: any) => row.status === status).length;
    return acc;
  }, {});
  summary.total_recorded = rows.length;
  summary.missing = Math.max(0, expected - rows.length);
  return summary;
}

function employeeRows(employees: any[], attendanceRows: any[], month: string) {
  const dates = datesForMonth(month);
  const attendanceMap = new Map(attendanceRows.map((row: any) => [`${row.employee_id}:${row.attendance_date}`, row]));
  return employees.map((employee: any) => {
    const days = dates.map((date) => attendanceMap.get(`${employee.id}:${date}`) || null);
    const summary = ATTENDANCE_STATUSES.reduce((acc: any, status) => {
      acc[status] = days.filter((day: any) => day?.status === status).length;
      return acc;
    }, {});
    summary.total_recorded = days.filter(Boolean).length;
    summary.missing = Math.max(0, dates.length - summary.total_recorded);
    return { employee, days, summary };
  });
}

export async function loadVisiblePeriods(admin: any, auth: any, statusFilter: string | null = "pending") {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const statuses = periodStatusesFromFilter(statusFilter);
  let query = admin
    .from("employee_attendance_periods")
    .select("*")
    .order("period_month", { ascending: false })
    .order("submitted_at", { ascending: true, nullsFirst: false });
  if (statuses?.length) query = query.in("status", statuses);
  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return [];
  const { data, error } = await scopedQuery;
  if (error) throw error;

  let scopedPeriods = data || [];
  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    scopedPeriods = scopedPeriods.filter((period: any) => {
      if (assignments.siteIds.length > 0 && !assignments.siteIds.includes(period.site_id)) return false;
      if (assignments.siteIds.length === 0 && assignments.companyIds.length > 0 && !assignments.companyIds.includes(period.company_id)) return false;
      return true;
    });
  }

  return scopedPeriods.filter((period: any) => canReviewEmployeeAttendancePeriod(auth, period));
}

export async function enrichPeriodRows(admin: any, periods: any[]) {
  const companyIds = Array.from(new Set(periods.map((period) => period.company_id).filter(Boolean)));
  const siteIds = Array.from(new Set(periods.map((period) => period.site_id).filter(Boolean)));
  const periodIds = periods.map((period) => period.id).filter(Boolean);
  const [companyResult, siteResult, attendanceResult] = await Promise.all([
    companyIds.length
      ? admin.from("companies").select("id, company_name, company_code").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
      : Promise.resolve({ data: [], error: null }),
    periodIds.length
      ? admin.from("employee_attendance").select("period_id, employee_id").in("period_id", periodIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (companyResult.error) throw companyResult.error;
  if (siteResult.error) throw siteResult.error;
  if (attendanceResult.error) throw attendanceResult.error;
  const companies = new Map((companyResult.data || []).map((row: any) => [row.id, row.company_name || row.company_code || "Company"]));
  const sites = new Map((siteResult.data || []).map((row: any) => [row.id, row.site_name || row.site_code || "Site"]));
  const employeeIdsByPeriod = new Map<string, Set<string>>();
  for (const row of attendanceResult.data || []) {
    if (!row.period_id || !row.employee_id) continue;
    employeeIdsByPeriod.set(row.period_id, employeeIdsByPeriod.get(row.period_id) || new Set());
    employeeIdsByPeriod.get(row.period_id)!.add(row.employee_id);
  }
  return periods.map((period) => ({
    id: period.id,
    organization_id: period.organization_id,
    company_id: period.company_id,
    site_id: period.site_id,
    company_name: companies.get(period.company_id) || "Company",
    site_name: sites.get(period.site_id) || "Site",
    period_month: period.period_month,
    period_label: monthLabel(period.period_month),
    status: period.status,
    status_label: statusLabel(period.status),
    current_approval_level: period.current_approval_level,
    approval_workflow_snapshot: period.approval_workflow_snapshot || {},
    current_level_label: currentLevelLabel(period),
    submitted_by_name: period.submitted_by_name,
    submitted_at: period.submitted_at,
    employee_count: employeeIdsByPeriod.get(period.id)?.size || 0,
    summary: period.summary || {},
  }));
}

export async function loadDetail(admin: any, auth: any, periodId: string) {
  const periods = await loadVisiblePeriods(admin, auth, "all");
  const period = periods.find((row: any) => row.id === periodId);
  if (!period) return { response: jsonError("Attendance approval package was not found or is not waiting for your approval.", 404) } as const;

  const dates = datesForMonth(period.period_month);
  const [employees, attendanceRows, auditResult, enrichedList] = await Promise.all([
    loadEligibleEmployees(admin, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    }),
    loadAttendanceRows(admin, {
      organizationId: period.organization_id,
      companyId: period.company_id,
      siteId: period.site_id,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    }),
    admin
      .from("erp_audit_logs")
      .select("id, action, description, old_values, new_values, created_by_name, created_by_email, created_at")
      .eq("entity_type", "employee_attendance_period")
      .eq("record_id", period.id)
      .order("created_at", { ascending: true }),
    enrichPeriodRows(admin, [period]),
  ]);
  if (auditResult.error) throw auditResult.error;
  const departmentIds = Array.from(new Set(employees.map((employee: any) => employee.department_id).filter(Boolean)));
  const designationIds = Array.from(new Set(employees.map((employee: any) => employee.designation_id).filter(Boolean)));
  const [departmentResult, designationResult] = await Promise.all([
    departmentIds.length
      ? admin.from("hr_departments").select("id, department_name").in("id", departmentIds)
      : Promise.resolve({ data: [], error: null }),
    designationIds.length
      ? admin.from("hr_designations").select("id, designation_name").in("id", designationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (departmentResult.error) throw departmentResult.error;
  if (designationResult.error) throw designationResult.error;
  const departments = new Map((departmentResult.data || []).map((row: any) => [row.id, row.department_name]));
  const designations = new Map((designationResult.data || []).map((row: any) => [row.id, row.designation_name]));
  const enrichedEmployees = employees.map((employee: any) => ({
    ...employee,
    department_name: departments.get(employee.department_id) || null,
    designation_name: designations.get(employee.designation_id) || null,
  }));
  const policySnapshot = period.approval_workflow_snapshot || {};
  const approvalLayers = Array.isArray(policySnapshot.approval_layers) ? policySnapshot.approval_layers : [];
  const approverUserIds = Array.from(new Set(approvalLayers.map((layer: any) => layer.approver_user_id).filter(Boolean)));
  let approvers = new Map<string, string>();
  if (approverUserIds.length > 0) {
    const { data: profileRows, error: profileError } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", approverUserIds);
    if (profileError) throw profileError;
    approvers = new Map((profileRows || []).map((profile: any) => [profile.id, profile.full_name || profile.email || "Approver"]));
  }
  const enrichedPolicySnapshot = {
    ...policySnapshot,
    approval_layers: approvalLayers.map((layer: any) => ({
      ...layer,
      approver_name: layer.approver_user_id ? approvers.get(layer.approver_user_id) || "Approver" : "Not configured",
    })),
  };
  const rows = employeeRows(enrichedEmployees, attendanceRows, period.period_month);
  return {
    detail: {
      ...enrichedList[0],
      dates,
      period,
      policy_snapshot: enrichedPolicySnapshot,
      employees: enrichedEmployees,
      attendance: attendanceRows,
      rows,
      summary: summarizeRows(enrichedEmployees, attendanceRows, period.period_month),
      history: auditResult.data || [],
      attendance_status_labels: ATTENDANCE_STATUS_LABELS,
    },
  } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    if (
      !hasAttendanceApprovalPermission(auth, "view") &&
      !hasAttendanceApprovalPermission(auth, "approve") &&
      !hasAttendanceApprovalPermission(auth, "reject")
    ) {
      const hasConfiguredResponsibility = !hasAttendanceApprovalPermission(auth, "view");
      if (!hasConfiguredResponsibility) return jsonError("You do not have permission to view attendance approvals.", 403);
    }

    const admin = adminClient();
    const params = new URL(request.url).searchParams;
    const periodId = params.get("period_id");
    if (periodId) {
      const loaded = await loadDetail(admin, auth, periodId);
      if ("response" in loaded) return loaded.response;
      return NextResponse.json(loaded.detail);
    }

    const periods = await loadVisiblePeriods(admin, auth, params.get("period_status") || "pending");
    const rows = await enrichPeriodRows(admin, periods);
    return NextResponse.json({ rows, count: rows.length });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee attendance approvals.", 500);
  }
}
