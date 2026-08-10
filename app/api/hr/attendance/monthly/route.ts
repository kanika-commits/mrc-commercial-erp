import { NextResponse } from "next/server";
import { ATTENDANCE_STATUSES, datesForMonth } from "@/lib/hr/attendance";
import {
  adminClient,
  ensurePeriod,
  jsonError,
  loadAttendanceRows,
  loadEligibleEmployees,
  loadEmployeeAttendanceLookups,
  loadEmployeeAttendancePolicyForScope,
  parseMonthlyParams,
  requireAttendanceView,
  validateCompanySiteScope,
} from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceView(request);
    if ("response" in auth) return auth.response;

    const params = parseMonthlyParams(request.url);
    if ("error" in params) return jsonError(String(params.error), 400);

    const admin = adminClient();
    const monthDates = datesForMonth(params.month);
    const lookup = params.companyId ? null : await loadEmployeeAttendanceLookups(admin, auth);
    const companyIds = params.companyId ? [params.companyId] : Array.from(new Set((lookup?.pairs || []).filter((pair: any) => pair.site_id === params.siteId).map((pair: any) => pair.company_id)));
    if (!companyIds.length) return jsonError("No permitted companies are available for the selected site.", 403);
    const scopes = await Promise.all(companyIds.map((companyId) => validateCompanySiteScope(admin, auth, companyId, params.siteId)));
    const rejectedScope = scopes.find((scope) => "response" in scope);
    if (rejectedScope && "response" in rejectedScope) return rejectedScope.response;
    const organizationId = (scopes[0] as any).organizationId;
    const companyResults = await Promise.all(companyIds.map(async (companyId) => {
      const [employees, attendanceRows, period, dayLocks, policy] = await Promise.all([
        loadEligibleEmployees(admin, { organizationId, companyId, siteId: params.siteId, startDate: monthDates[0], endDate: monthDates[monthDates.length - 1] }),
        loadAttendanceRows(admin, { organizationId, companyId, siteId: params.siteId, startDate: monthDates[0], endDate: monthDates[monthDates.length - 1] }),
        ensurePeriod(admin, auth, { organizationId, companyId, siteId: params.siteId, month: params.month }),
        admin.from("employee_attendance_day_locks").select("*").eq("organization_id", organizationId).eq("company_id", companyId).eq("site_id", params.siteId).gte("attendance_date", monthDates[0]).lte("attendance_date", monthDates[monthDates.length - 1]).eq("is_locked", true),
        loadEmployeeAttendancePolicyForScope(admin, { organizationId, siteId: params.siteId }),
      ]);
      if (dayLocks.error) throw dayLocks.error;
      return { employees, attendanceRows, period, dayLocks: dayLocks.data || [], policy };
    }));
    const employees = companyResults.flatMap((item) => item.employees);
    const attendanceRows = companyResults.flatMap((item) => item.attendanceRows);
    const periods = companyResults.map((item) => item.period).filter(Boolean);
    const dayLocks = companyResults.flatMap((item) => item.dayLocks);
    const period = periods[0] || null;
    const policy = companyResults.find((item) => item.policy)?.policy || null;
    const attendanceMap = new Map(attendanceRows.map((row: any) => [`${row.employee_id}:${row.attendance_date}`, row]));
    const rows = employees.map((employee: any) => {
      const dayStatuses = monthDates.map((date) => attendanceMap.get(`${employee.id}:${date}`)?.status || null);
      const employeeSummary = ATTENDANCE_STATUSES.reduce((acc: any, status) => {
        acc[status] = dayStatuses.filter((dayStatus) => dayStatus === status).length;
        return acc;
      }, {});
      employeeSummary.total_recorded = dayStatuses.filter(Boolean).length;
      employeeSummary.missing = Math.max(0, monthDates.length - employeeSummary.total_recorded);
      return {
        employee,
        days: monthDates.map((date) => attendanceMap.get(`${employee.id}:${date}`) || null),
        summary: employeeSummary,
      };
    });

    const summary = ATTENDANCE_STATUSES.reduce((acc: any, status) => {
      acc[status] = attendanceRows.filter((row: any) => row.status === status).length;
      return acc;
    }, {});
    summary.total_recorded = attendanceRows.length;
    summary.missing = Math.max(0, employees.length * monthDates.length - attendanceRows.length);

    return NextResponse.json({
      month: params.month,
      dates: monthDates,
      employees,
      rows,
      attendance: attendanceRows,
      day_locks: dayLocks,
      period,
      periods,
      policy,
      summary,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load monthly attendance.", 500);
  }
}
