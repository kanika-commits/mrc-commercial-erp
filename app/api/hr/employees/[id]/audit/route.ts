import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  hrAdminClient,
} from "../../_shared";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, "hr_audit", "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = hrAdminClient();
    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id")
      .eq("id", id)
      .neq("status", "deleted")
      .maybeSingle();

    if (employeeError) throw employeeError;
    if (!employee) return jsonError("Employee was not found.", 404);

    if (!(await canAccessHrEmployee(admin, auth, employee))) {
      return jsonError("You do not have access to this employee.", 403);
    }

    const { searchParams } = new URL(request.url);
    let query = admin
      .from("erp_audit_logs")
      .select("*")
      .eq("organization_id", employee.organization_id)
      .or(`record_id.eq.${id},parent_record_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(200);

    const action = searchParams.get("action")?.trim();
    const source = searchParams.get("source")?.trim();
    const user = searchParams.get("user")?.trim();
    const dateFrom = searchParams.get("date_from")?.trim();
    const dateTo = searchParams.get("date_to")?.trim();
    const search = searchParams.get("search")?.trim();

    if (action) query = query.eq("action", action);
    if (source) query = query.eq("source", source);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (user) query = query.or(`created_by_email.ilike.%${user}%,created_by_name.ilike.%${user}%`);
    if (search) query = query.or(`action.ilike.%${search}%,description.ilike.%${search}%,created_by_email.ilike.%${search}%,created_by_name.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ auditLogs: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee audit trail.", 500);
  }
}
