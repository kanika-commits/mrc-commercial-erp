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

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "edit");

    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const departmentName = String(payload.department_name || "").trim();
    const departmentCode = String(payload.department_code || "").trim();
    const status = String(payload.status || "active").trim() || "active";
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!departmentName) {
      return NextResponse.json(
        { error: "Department name is required." },
        { status: 400 }
      );
    }

    const { data: department, error: departmentError } = await admin
      .from("hr_departments")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (departmentError) throw departmentError;

    if (!department) {
      return NextResponse.json({ error: "Department was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, department.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("hr_departments")
      .select("id")
      .eq("organization_id", department.organization_id)
      .ilike("department_name", departmentName)
      .neq("id", id)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicate) {
      return NextResponse.json(
        { error: "Department name already exists for this organization." },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("hr_departments")
      .update({
        department_name: departmentName,
        department_code: departmentCode || null,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ department_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update department." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "delete");

    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);

    const { data: department, error: departmentError } = await admin
      .from("hr_departments")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (departmentError) throw departmentError;

    if (!department) {
      return NextResponse.json({ error: "Department was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, department.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const { count, error: employeeError } = await admin
      .from("hr_employees")
      .select("id", { count: "exact", head: true })
      .eq("department_id", id)
      .eq("status", "active");

    if (employeeError) throw employeeError;

    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: "Department cannot be deleted because active employees are linked." },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("hr_departments")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete department." },
      { status: 500 }
    );
  }
}
