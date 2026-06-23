import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
  resolveWriteOrganizationId,
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
    const departmentId = searchParams.get("department_id")?.trim();
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    let query = admin
      .from("hr_designations")
      .select("id, organization_id, department_id, designation_name, designation_code, status, created_at, updated_at")
      .neq("status", "deleted")
      .order("designation_name", { ascending: true });

    const scopedQuery = applyOrganizationScope(query, organizationScope);
    if (!scopedQuery) {
      return NextResponse.json({ designations: [] });
    }

    query = scopedQuery;

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ designations: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load designations." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "add");

    if ("response" in auth) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const organizationId = resolveWriteOrganizationId(
      organizationScope,
      payload.organization_id
    );
    const departmentId = String(payload.department_id || "").trim();
    const designationName = String(payload.designation_name || "").trim();
    const designationCode = String(payload.designation_code || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!organizationId) {
      return NextResponse.json(
        { error: "You cannot create designations outside your organization." },
        { status: 403 }
      );
    }

    if (!designationName) {
      return NextResponse.json(
        { error: "Designation name is required." },
        { status: 400 }
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
        department.organization_id !== organizationId ||
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
      .eq("organization_id", organizationId)
      .ilike("designation_name", designationName)
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

    const { data, error } = await admin
      .from("hr_designations")
      .insert({
        organization_id: organizationId,
        department_id: departmentId || null,
        designation_name: designationName,
        designation_code: designationCode || null,
        status,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ designation_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create designation." },
      { status: 500 }
    );
  }
}
