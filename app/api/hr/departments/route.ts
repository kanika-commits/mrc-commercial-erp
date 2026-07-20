import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
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

    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    let query = admin
      .from("hr_departments")
      .select("id, organization_id, department_name, department_code, status, created_at, updated_at")
      .neq("status", "deleted")
      .order("department_name", { ascending: true });

    const scopedQuery = applyOrganizationScope(query, organizationScope);
    if (!scopedQuery) {
      return NextResponse.json({ departments: [] });
    }

    query = scopedQuery;

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ departments: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load departments." },
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
    const departmentName = String(payload.department_name || "").trim();
    const departmentCode = String(payload.department_code || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!organizationId) {
      return NextResponse.json(
        { error: "You cannot create departments outside your organization." },
        { status: 403 }
      );
    }

    if (!departmentName) {
      return NextResponse.json(
        { error: "Department name is required." },
        { status: 400 }
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("hr_departments")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("department_name", departmentName)
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

    const { data, error } = await admin
      .from("hr_departments")
      .insert({
        organization_id: organizationId,
        department_name: departmentName,
        department_code: departmentCode || null,
        status,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ department_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create department." },
      { status: 500 }
    );
  }
}
