import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "../../_shared";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, HR_EMPLOYEES_MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = hrAdminClient();
    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id, status")
      .eq("id", id)
      .neq("status", "deleted")
      .maybeSingle();

    if (employeeError) throw employeeError;
    if (!employee) return jsonError("Employee was not found.", 404);

    if (!(await canAccessHrEmployee(admin, auth, employee))) {
      return jsonError("You do not have access to this employee.", 403);
    }

    const { data, error } = await admin
      .from("employee_compliance_records")
      .select("id, organization_id, employee_id, record_type, record_number, record_name, issue_date, expiry_date, issuing_authority, metadata, source, status, created_at, updated_at")
      .eq("employee_id", id)
      .eq("status", "active")
      .order("record_type", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ complianceRecords: data || [] });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to load employee compliance records."), 500);
  }
}
