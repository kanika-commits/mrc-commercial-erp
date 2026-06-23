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
    const departmentId = String(payload.department_id || "").trim();
    const designationName = String(payload.designation_name || "").trim();
    const designationCode = String(payload.designation_code || "").trim();
    const status = String(payload.status || "active").trim() || "active";
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!designationName) {
      return NextResponse.json(
        { error: "Designation name is required." },
        { status: 400 }
      );
    }

    const { data: designation, error: designationError } = await admin
      .from("hr_designations")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (designationError) throw designationError;

    if (!designation) {
      return NextResponse.json({ error: "Designation was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, designation.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    if (departmentId) {
      const { data: department, error: departmentError } = await admin
        .from("hr_departments")
        .select("id, organization_id")
        .eq("id", departmentId)
        .maybeSingle();

      if (departmentError) throw departmentError;

      if (
        !department ||
        department.organization_id !== designation.organization_id ||
        !isInOrganizationScope(organizationScope, department.organization_id)
      ) {
        return NextResponse.json(
          { error: "Selected department is not available for this organization." },
          { status: 403 }
        );
      }
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("hr_designations")
      .select("id")
      .eq("organization_id", designation.organization_id)
      .ilike("designation_name", designationName)
      .neq("id", id)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicate) {
      return NextResponse.json(
        { error: "Designation name already exists for this organization." },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("hr_designations")
      .update({
        department_id: departmentId || null,
        designation_name: designationName,
        designation_code: designationCode || null,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ designation_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update designation." },
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

    const { data: designation, error: designationError } = await admin
      .from("hr_designations")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (designationError) throw designationError;

    if (!designation) {
      return NextResponse.json({ error: "Designation was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, designation.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const { count, error: employeeError } = await admin
      .from("hr_employees")
      .select("id", { count: "exact", head: true })
      .eq("designation_id", id)
      .eq("status", "active");

    if (employeeError) throw employeeError;

    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: "Designation cannot be deleted because active employees are linked." },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("hr_designations")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete designation." },
      { status: 500 }
    );
  }
}
