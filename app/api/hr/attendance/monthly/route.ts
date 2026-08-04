import { NextResponse } from "next/server";
import { ATTENDANCE_STATUSES, datesForMonth } from "@/lib/hr/attendance";
import {
  adminClient,
  ensurePeriod,
  jsonError,
  loadAttendanceRows,
  loadEligibleEmployees,
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
    const scope = await validateCompanySiteScope(admin, auth, params.companyId, params.siteId);
    if ("response" in scope) return scope.response;

    const monthDates = datesForMonth(params.month);
    const [employees, attendanceRows, period, dayLocks, policy] = await Promise.all([
      loadEligibleEmployees(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        startDate: monthDates[0],
        endDate: monthDates[monthDates.length - 1],
      }),
      loadAttendanceRows(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        startDate: monthDates[0],
        endDate: monthDates[monthDates.length - 1],
      }),
      ensurePeriod(admin, auth, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
        month: params.month,
      }),
      admin
        .from("employee_attendance_day_locks")
        .select("*")
        .eq("organization_id", scope.organizationId)
        .eq("company_id", params.companyId)
        .eq("site_id", params.siteId)
        .gte("attendance_date", monthDates[0])
        .lte("attendance_date", monthDates[monthDates.length - 1])
        .eq("is_locked", true),
      loadEmployeeAttendancePolicyForScope(admin, {
        organizationId: scope.organizationId,
        companyId: params.companyId,
        siteId: params.siteId,
      }),
    ]);

    if (dayLocks.error) throw dayLocks.error;
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
      day_locks: dayLocks.data || [],
      period,
      policy,
      summary,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load monthly attendance.", 500);
  }
}
