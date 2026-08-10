import { NextResponse } from "next/server";
import { applyOrganizationScope, isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  adminClient,
  hasAttendanceApprovalPermission,
  jsonError,
  loadActorAssignments,
  loadEligibleEmployees,
  loadEmployeeAttendanceLookups,
  loadAttendanceRows,
  requireAttendanceApprovalActor,
} from "../_shared";

function statusFilter(value: string) {
  if (value === "approved") return ["approved"];
  if (value === "reopened" || value === "sent_back") return ["reopened"];
  if (value === "all") return ["submitted", "approved", "reopened", "cancelled", "draft"];
  return ["submitted"];
}

function groupLabel(statuses: string[]) {
  if (statuses.length && statuses.every((status) => status === "approved")) return "Approved";
  if (statuses.some((status) => status === "reopened")) return "Reopened";
  if (statuses.some((status) => status === "submitted")) return "Pending Approval";
  if (statuses.some((status) => status === "cancelled")) return "Cancelled";
  return "Draft";
}

async function accessibleDailyRows(admin: any, auth: any, statuses: string[]) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin
    .from("employee_attendance_daily_submissions")
    .select("*, companies(company_name, company_code), sites(site_name, site_code)")
    .in("status", statuses)
    .order("attendance_date", { ascending: false })
    .order("submitted_at", { ascending: true, nullsFirst: false });
  query = applyOrganizationScope(query, organizationScope);
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    rows = rows.filter((row: any) => assignments.rows.some((assignment: any) =>
      (!assignment.organization_id || assignment.organization_id === row.organization_id) &&
      (!assignment.company_id || assignment.company_id === row.company_id) &&
      (!assignment.site_id || assignment.site_id === row.site_id),
    ));
  }
  return rows;
}

function groupRows(rows: any[], auth: any) {
  const groups = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.organization_id}:${row.site_id}:${row.attendance_date}`;
    const group = groups.get(key) || {
      id: key,
      organization_id: row.organization_id,
      site_id: row.site_id,
      attendance_date: row.attendance_date,
      period_month: `${row.attendance_date}`.slice(0, 7) + "-01",
      period_label: row.attendance_date,
      site_name: row.sites?.site_name || row.sites?.site_code || "Site",
      periods: [],
      total_employee_count: 0,
      company_count: 0,
    };
    group.periods.push({
      period_id: row.period_id,
      daily_submission_id: row.id,
      company_id: row.company_id,
      company_name: row.companies?.company_name || row.companies?.company_code || "Company",
      employee_count: 0,
      status: row.status,
      status_label: row.status,
      submitted_by_name: row.submitted_by_name,
      submitted_at: row.submitted_at,
      can_approve: hasAttendanceApprovalPermission(auth, "approve") && row.status === "submitted",
      can_send_back: hasAttendanceApprovalPermission(auth, "reject") && row.status === "submitted",
    });
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    group.company_count = group.periods.length;
    group.status = groupLabel(group.periods.map((item: any) => item.status));
    group.status_label = group.status;
    group.submitted_by_name = group.periods.map((item: any) => item.submitted_by_name).filter(Boolean).join(", ") || "-";
    group.submitted_at = group.periods.map((item: any) => item.submitted_at).filter(Boolean).sort().reverse()[0] || null;
    return group;
  });
}

async function loadDailyDetail(admin: any, auth: any, group: any, states: any[], dates: string[]) {
  const rowMap = new Map<string, any>();
  const periods: any[] = [];
  for (const state of states) {
    const employees = await loadEligibleEmployees(admin, {
      organizationId: state.organization_id,
      companyId: state.company_id,
      siteId: state.site_id,
      startDate: state.attendance_date,
      endDate: state.attendance_date,
    });
    const attendance = await loadAttendanceRows(admin, {
      organizationId: state.organization_id,
      companyId: state.company_id,
      siteId: state.site_id,
      startDate: state.attendance_date,
      endDate: state.attendance_date,
    });
    const attendanceByEmployee = new Map(attendance.map((row: any) => [row.employee_id, row]));
    const companyName = state.companies?.company_name || state.companies?.company_code || "Company";
    periods.push({ ...state, daily_submission_id: state.id, company_name: companyName, employee_count: employees.length, status_label: state.status, can_approve: state.status === "submitted", can_send_back: state.status === "submitted" });
    for (const employee of employees) {
      const key = employee.id;
      const current = rowMap.get(key) || { employee: { ...employee, company_name: companyName }, company_id: state.company_id, company_name: companyName, days: Array(dates.length).fill(null) };
      const dateIndex = dates.indexOf(state.attendance_date);
      if (dateIndex >= 0) current.days[dateIndex] = attendanceByEmployee.get(employee.id) || null;
      rowMap.set(key, current);
    }
  }
  const allRows = Array.from(rowMap.values());
  return {
    ...group,
    periods,
    dates,
    rows: allRows,
    employees: allRows.map((row) => ({ ...row.employee, company_id: row.company_id, company_name: row.company_name })),
    history: [],
    policy_snapshot: {},
    workflow_states: states.map((state: any) => ({ ...state, company_name: state.companies?.company_name || state.companies?.company_code || "Company" })),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const params = new URL(request.url).searchParams;
    const selectedSiteId = params.get("site_id");
    const filterFromDate = params.get("from_date");
    const filterToDate = params.get("to_date");
    if ((filterFromDate && !/^\d{4}-\d{2}-\d{2}$/.test(filterFromDate)) || (filterToDate && !/^\d{4}-\d{2}-\d{2}$/.test(filterToDate)) || (filterFromDate && filterToDate && filterFromDate > filterToDate)) {
      return NextResponse.json({ error: "A valid date range is required." }, { status: 400 });
    }
    const allStates = await accessibleDailyRows(admin, auth, statusFilter(params.get("period_status") || "pending"));
    const states = allStates.filter((row: any) => (!selectedSiteId || row.site_id === selectedSiteId) && (!filterFromDate || row.attendance_date >= filterFromDate) && (!filterToDate || row.attendance_date <= filterToDate));
    const groups = groupRows(states, auth);
    const lookup = await loadEmployeeAttendanceLookups(admin, auth);
    const siteMap = new Map<string, any>();
    for (const pair of lookup.pairs || []) if (!siteMap.has(pair.site_id)) siteMap.set(pair.site_id, { id: pair.site_id, label: pair.site_name, organization_id: pair.organization_id });
    const sites = Array.from(siteMap.values());
    for (const group of groups) {
      const groupStates = states.filter((row: any) => row.organization_id === group.organization_id && row.site_id === group.site_id && row.attendance_date === group.attendance_date);
      const counts = await Promise.all(groupStates.map((state: any) => loadEligibleEmployees(admin, { organizationId: state.organization_id, companyId: state.company_id, siteId: state.site_id, startDate: state.attendance_date, endDate: state.attendance_date }).then((rows) => rows.length)));
      group.total_employee_count = counts.reduce((sum, count) => sum + count, 0);
      group.periods.forEach((period: any, index: number) => { period.employee_count = counts[index] || 0; });
    }
    const siteId = selectedSiteId;
    const attendanceDate = params.get("attendance_date");
    const fromDate = params.get("from_date") || attendanceDate;
    const toDate = params.get("to_date") || attendanceDate;
    if (attendanceDate && (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate)) {
      return NextResponse.json({ error: "A valid date range is required." }, { status: 400 });
    }
    const group = groups.find((item) => (!siteId || item.site_id === siteId) && (!attendanceDate || item.attendance_date === attendanceDate));
    if (attendanceDate) {
      if (!group) return NextResponse.json({ error: "Daily attendance approval group was not found." }, { status: 404 });
      const rangeStates = await accessibleDailyRows(admin, auth, ["submitted", "approved", "reopened", "cancelled", "draft"]);
      const rangeFrom = fromDate as string;
      const rangeTo = toDate as string;
      const rangeDates = Array.from({ length: Math.max(0, Math.round((Date.parse(`${rangeTo}T00:00:00Z`) - Date.parse(`${rangeFrom}T00:00:00Z`)) / 86400000)) + 1 }, (_, index) => new Date(Date.parse(`${rangeFrom}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10));
      const selectedStates = rangeStates.filter((row: any) => row.site_id === group.site_id && row.attendance_date >= rangeFrom && row.attendance_date <= rangeTo);
      return NextResponse.json(await loadDailyDetail(admin, auth, group, selectedStates, rangeDates));
    }
    return NextResponse.json({ groups, count: groups.length, sites });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load daily attendance approvals.", 500);
  }
}
