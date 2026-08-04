import {
  adminClient,
  attendanceExportFilename,
  jsonError,
  loadAttendanceRows,
  loadEligibleEmployees,
  parseMonthlyParams,
  requireAttendancePermission,
  validateCompanySiteScope,
} from "../_shared";
import { ATTENDANCE_STATUS_CODES, ATTENDANCE_STATUSES, datesForMonth } from "@/lib/hr/attendance";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendancePermission(request, "export");
    if ("response" in auth) return auth.response;
    const params = parseMonthlyParams(request.url);
    if ("error" in params) return jsonError(String(params.error), 400);

    const admin = adminClient();
    const scope = await validateCompanySiteScope(admin, auth, params.companyId, params.siteId);
    if ("response" in scope) return scope.response;
    const monthDates = datesForMonth(params.month);
    const [employees, attendanceRows, companyResult, siteResult, departmentResult, designationResult, periodResult] = await Promise.all([
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
      admin.from("companies").select("company_name").eq("id", params.companyId).maybeSingle(),
      admin.from("sites").select("site_name").eq("id", params.siteId).maybeSingle(),
      admin.from("hr_departments").select("id, department_name").eq("organization_id", scope.organizationId),
      admin.from("hr_designations").select("id, designation_name").eq("organization_id", scope.organizationId),
      admin.from("employee_attendance_periods").select("status").eq("organization_id", scope.organizationId).eq("company_id", params.companyId).eq("site_id", params.siteId).eq("period_month", params.month).maybeSingle(),
    ]);
    for (const result of [companyResult, siteResult, departmentResult, designationResult, periodResult]) {
      if (result.error) throw result.error;
    }
    const attendanceMap = new Map(attendanceRows.map((row: any) => [`${row.employee_id}:${row.attendance_date}`, row]));
    const departments = new Map((departmentResult.data || []).map((row: any) => [row.id, row.department_name]));
    const designations = new Map((designationResult.data || []).map((row: any) => [row.id, row.designation_name]));
    const header = [
      "Employee Code",
      "Employee Name",
      "Department",
      "Designation",
      ...monthDates.map((date) => date.slice(-2)),
      ...ATTENDANCE_STATUSES.map((status) => status),
      "Missing",
      "Total Recorded",
      "Period Status",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const employee of employees) {
      const counts: Record<string, number> = {};
      for (const status of ATTENDANCE_STATUSES) counts[status] = 0;
      let recorded = 0;
      const dayValues = monthDates.map((date) => {
        const status = attendanceMap.get(`${employee.id}:${date}`)?.status;
        if (status) {
          counts[status] += 1;
          recorded += 1;
        }
        return status ? ATTENDANCE_STATUS_CODES[status as keyof typeof ATTENDANCE_STATUS_CODES] : "";
      });
      const row = [
        employee.employee_code,
        employee.employee_name,
        departments.get(employee.department_id) || "",
        designations.get(employee.designation_id) || "",
        ...dayValues,
        ...ATTENDANCE_STATUSES.map((status) => counts[status]),
        monthDates.length - recorded,
        recorded,
        periodResult.data?.status || "draft",
      ];
      lines.push(row.map(csvCell).join(","));
    }
    const filename = attendanceExportFilename(
      companyResult.data?.company_name || "company",
      siteResult.data?.site_name || "site",
      params.month,
    );
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to export attendance.", 500);
  }
}
