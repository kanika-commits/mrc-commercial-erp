import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

const MODULE_CODE = "hr_employees";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");

    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employee_id")?.trim();

    if (!employeeId) {
      return NextResponse.json({ error: "Employee id is required." }, { status: 400 });
    }

    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, organization_id, user_id")
      .eq("id", employeeId)
      .neq("status", "deleted")
      .maybeSingle();

    if (employeeError) throw employeeError;

    if (!employee) {
      return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, employee.organization_id)) {
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

    if (userIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const [profiles, linkedEmployees] = await Promise.all([
      admin
        .from("profiles")
        .select("id, email, full_name, status")
        .in("id", userIds)
        .order("email", { ascending: true }),
      admin
        .from("hr_employees")
        .select("id, user_id")
        .eq("organization_id", employee.organization_id)
        .neq("status", "deleted")
        .not("user_id", "is", null),
    ]);

    if (profiles.error) throw profiles.error;
    if (linkedEmployees.error) throw linkedEmployees.error;

    const linkedEmployeeByUserId = new Map(
      (linkedEmployees.data || [])
        .filter((row) => row.user_id)
        .map((row) => [row.user_id as string, row.id as string]),
    );

    return NextResponse.json({
      users: (profiles.data || []).map((profile) => ({
        ...profile,
        linked_employee_id: linkedEmployeeByUserId.get(profile.id) || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load ERP users." },
      { status: 500 },
    );
  }
}
