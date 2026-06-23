import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
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

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean))
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean))
    ) as string[],
  };
}

function userName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "HR User"
  );
}

async function validateCompanyAndSite(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  companyId: string,
  siteId: string | null | undefined
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (!companyId) {
    return { error: "Company is required.", status: 400 } as const;
  }

  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id, organization_id")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;

  if (!company) {
    return { error: "Selected company was not found.", status: 404 } as const;
  }

  if (!isInOrganizationScope(organizationScope, company.organization_id)) {
    return {
      error: "Selected company is not available for this organization.",
      status: 403,
    } as const;
  }

  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);

    if (assignments.siteIds.length > 0) {
      if (!siteId || !assignments.siteIds.includes(siteId)) {
        return {
          error: "Selected site is not available for this user.",
          status: 403,
        } as const;
      }
    } else if (
      assignments.companyIds.length > 0 &&
      !assignments.companyIds.includes(companyId)
    ) {
      return {
        error: "Selected company is not available for this user.",
        status: 403,
      } as const;
    }
  }

  if (siteId) {
    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("id, organization_id, company_id")
      .eq("id", siteId)
      .maybeSingle();

    if (siteError) throw siteError;

    if (
      !site ||
      site.organization_id !== company.organization_id ||
      site.company_id !== companyId
    ) {
      return {
        error: "Selected site is not available for this company.",
        status: 403,
      } as const;
    }
  }

  return {
    organizationId: company.organization_id as string,
    organizationScope,
  };
}

async function validateHrParents(
  admin: ReturnType<typeof adminClient>,
  organizationId: string,
  values: {
    departmentId?: string | null;
    designationId?: string | null;
    reportingManagerId?: string | null;
  }
) {
  if (values.departmentId) {
    const { data, error } = await admin
      .from("hr_departments")
      .select("id, organization_id")
      .eq("id", values.departmentId)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.organization_id !== organizationId) {
      return { error: "Selected department is not available for this organization.", status: 403 } as const;
    }
  }

  if (values.designationId) {
    const { data, error } = await admin
      .from("hr_designations")
      .select("id, organization_id")
      .eq("id", values.designationId)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.organization_id !== organizationId) {
      return { error: "Selected designation is not available for this organization.", status: 403 } as const;
    }
  }

  if (values.reportingManagerId) {
    const { data, error } = await admin
      .from("hr_employees")
      .select("id, organization_id")
      .eq("id", values.reportingManagerId)
      .neq("status", "deleted")
      .maybeSingle();

    if (error) throw error;
    if (!data || data.organization_id !== organizationId) {
      return { error: "Selected reporting manager is not available for this organization.", status: 403 } as const;
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");

    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status")?.trim();
    const companyId = searchParams.get("company_id")?.trim();
    const siteId = searchParams.get("site_id")?.trim();
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAssignments(admin, auth.user.id);
    let query = admin
      .from("hr_employees")
      .select(
        "id, organization_id, company_id, site_id, employee_code, employee_name, email, phone, department_id, designation_id, reporting_manager_id, date_of_joining, employment_type, status, created_at, updated_at"
      )
      .neq("status", "deleted")
      .order("employee_name", { ascending: true });

    const scopedQuery = applyOrganizationScope(query, organizationScope);
    if (!scopedQuery) {
      return NextResponse.json({ employees: [] });
    }

    query = scopedQuery;

    if (assignments.siteIds.length > 0) {
      query = query.in("site_id", assignments.siteIds);
    } else if (assignments.companyIds.length > 0) {
      query = query.in("company_id", assignments.companyIds);
    }

    if (companyId) query = query.eq("company_id", companyId);
    if (siteId) query = query.eq("site_id", siteId);
    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(
        `employee_code.ilike.%${search}%,employee_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ employees: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load employees." },
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
    const companyId = String(payload.company_id || "").trim();
    const siteId = String(payload.site_id || "").trim() || null;
    const employeeCode = String(payload.employee_code || "").trim();
    const employeeName = String(payload.employee_name || "").trim();
    const email = String(payload.email || "").trim() || null;
    const phone = String(payload.phone || "").trim() || null;
    const departmentId = String(payload.department_id || "").trim() || null;
    const designationId = String(payload.designation_id || "").trim() || null;
    const reportingManagerId =
      String(payload.reporting_manager_id || "").trim() || null;
    const status = String(payload.status || "active").trim() || "active";

    if (!employeeCode) {
      return NextResponse.json({ error: "Employee code is required." }, { status: 400 });
    }

    if (!employeeName) {
      return NextResponse.json({ error: "Employee name is required." }, { status: 400 });
    }

    const companyResult = await validateCompanyAndSite(admin, auth, companyId, siteId);
    if ("error" in companyResult) {
      return NextResponse.json(
        { error: companyResult.error },
        { status: companyResult.status }
      );
    }

    const parentError = await validateHrParents(admin, companyResult.organizationId, {
      departmentId,
      designationId,
      reportingManagerId,
    });

    if (parentError) {
      return NextResponse.json(
        { error: parentError.error },
        { status: parentError.status }
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("hr_employees")
      .select("id")
      .eq("organization_id", companyResult.organizationId)
      .ilike("employee_code", employeeCode)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicate) {
      return NextResponse.json(
        { error: "Employee code already exists for this organization." },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from("hr_employees")
      .insert({
        organization_id: companyResult.organizationId,
        company_id: companyId,
        site_id: siteId,
        employee_code: employeeCode,
        employee_name: employeeName,
        email,
        phone,
        department_id: departmentId,
        designation_id: designationId,
        reporting_manager_id: reportingManagerId,
        date_of_joining: payload.date_of_joining || null,
        employment_type: payload.employment_type || null,
        status,
        created_by: auth.user.id,
        created_by_name: userName(auth),
        created_by_email: auth.user.email || null,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ employee_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create employee." },
      { status: 500 }
    );
  }
}
