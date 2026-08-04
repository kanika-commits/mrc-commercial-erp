import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "@/app/api/hr/employees/_shared";

const MODULE_CODE = HR_EMPLOYEES_MODULE_CODE;

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");

    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employee_id")?.trim();

    if (!employeeId) {
      return NextResponse.json({ error: "Employee id is required." }, { status: 400 });
    }

    const admin = hrAdminClient();
    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id, user_id")
      .eq("id", employeeId)
      .neq("status", "deleted")
      .maybeSingle();

    if (employeeError) throw employeeError;

    if (!employee) {
      return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
    }

    if (!(await canAccessHrEmployee(admin, auth, employee))) {
      return NextResponse.json(
        { error: "You do not have access to this employee." },
        { status: 403 },
      );
    }

    const { data: accessRows, error: accessError } = await admin
      .from("user_access_assignments")
      .select("user_id")
      .eq("organization_id", employee.organization_id);

    if (accessError) throw accessError;

    const userIds = Array.from(
      new Set((accessRows || []).map((row) => row.user_id).filter(Boolean)),
    ) as string[];

    if (employee.user_id && !userIds.includes(employee.user_id)) {
      userIds.push(employee.user_id);
    }

    if (userIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const [profiles, linkedEmployees, userRoles, roles] = await Promise.all([
      admin
        .from("profiles")
        .select("id, email, full_name, status")
        .in("id", userIds)
        .or(`status.eq.active,id.eq.${employee.user_id || "00000000-0000-0000-0000-000000000000"}`)
        .order("email", { ascending: true }),
      admin
        .from("hr_employees")
        .select("id, user_id")
        .eq("organization_id", employee.organization_id)
        .neq("status", "deleted")
        .not("user_id", "is", null),
      admin
        .from("user_roles")
        .select("user_id, role_id")
        .in("user_id", userIds),
      admin
        .from("roles")
        .select("id, role_name, role_code")
        .order("role_name"),
    ]);

    if (profiles.error) throw profiles.error;
    if (linkedEmployees.error) throw linkedEmployees.error;
    if (userRoles.error) throw userRoles.error;
    if (roles.error) throw roles.error;

    const linkedEmployeeByUserId = new Map(
      (linkedEmployees.data || [])
        .filter((row) => row.user_id)
        .map((row) => [row.user_id as string, row.id as string]),
    );

    const roleSummaryByUserId = new Map<string, string>();
    const roleById = new Map(
      (roles.data || []).map((role: any) => [role.id, role]),
    );
    for (const row of userRoles.data || []) {
      const role = roleById.get(row.role_id);
      const label = role?.role_name || role?.role_code;
      if (!label) continue;
      const current = roleSummaryByUserId.get(row.user_id) || "";
      roleSummaryByUserId.set(row.user_id, current ? `${current}, ${label}` : label);
    }

    return NextResponse.json({
      users: (profiles.data || []).map((profile) => ({
        ...profile,
        linked_employee_id: linkedEmployeeByUserId.get(profile.id) || null,
        role_summary: roleSummaryByUserId.get(profile.id) || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load ERP users." },
      { status: 500 },
    );
  }
}
