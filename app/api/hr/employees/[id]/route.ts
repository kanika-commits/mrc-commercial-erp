import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
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

async function canAccessEmployee(
  admin: ReturnType<typeof adminClient>,
  auth: ServerPermissionContext,
  employee: any
) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (!isInOrganizationScope(organizationScope, employee.organization_id)) {
    return false;
  }

  if (isGlobalScope(organizationScope)) {
    return true;
  }

  const assignments = await loadActorAssignments(admin, auth.user.id);

  if (
    assignments.siteIds.length > 0 &&
    !assignments.siteIds.includes(employee.site_id)
  ) {
    return false;
  }

  if (
    assignments.siteIds.length === 0 &&
    assignments.companyIds.length > 0 &&
    !assignments.companyIds.includes(employee.company_id)
  ) {
    return false;
  }

  return true;
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

  return { organizationId: company.organization_id as string };
}

async function validateHrParents(
  admin: ReturnType<typeof adminClient>,
  organizationId: string,
  currentEmployeeId: string,
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
    if (values.reportingManagerId === currentEmployeeId) {
      return { error: "Reporting manager cannot be the same employee.", status: 400 } as const;
    }

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

async function validateLinkedUser(
  admin: ReturnType<typeof adminClient>,
  organizationId: string,
  currentEmployeeId: string,
  userId?: string | null,
) {
  if (!userId) return null;

  const { data: accessRow, error: accessError } = await admin
    .from("user_access_assignments")
    .select("user_id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  if (accessError) throw accessError;

  if (!accessRow) {
    return { error: "Selected ERP user is not available for this employee organization.", status: 403 } as const;
  }

  const { data: duplicate, error: duplicateError } = await admin
    .from("hr_employees")
    .select("id")
    .eq("user_id", userId)
    .neq("id", currentEmployeeId)
    .neq("status", "deleted")
    .limit(1)
    .maybeSingle();

  if (duplicateError) throw duplicateError;

  if (duplicate) {
    return { error: "Selected ERP user is already linked to another employee.", status: 409 } as const;
  }

  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");

    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const { data: employee, error } = await admin
      .from("hr_employees")
      .select("*")
      .eq("id", id)
      .neq("status", "deleted")
      .maybeSingle();

    if (error) throw error;

    if (!employee) {
      return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
    }

    if (!(await canAccessEmployee(admin, auth, employee))) {
      return NextResponse.json(
        { error: "You do not have access to this employee." },
        { status: 403 }
      );
    }

    return NextResponse.json({ employee });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load employee." },
      { status: 500 }
    );
  }
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
    const admin = adminClient();
    const { data: existing, error: existingError } = await admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id")
      .eq("id", id)
      .neq("status", "deleted")
      .maybeSingle();

    if (existingError) throw existingError;

    if (!existing) {
      return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
    }

    if (!(await canAccessEmployee(admin, auth, existing))) {
      return NextResponse.json(
        { error: "You do not have access to this employee." },
        { status: 403 }
      );
    }

    const companyId = String(payload.company_id || "").trim();
    const siteId = String(payload.site_id || "").trim() || null;
    const employeeCode = String(payload.employee_code || "").trim();
    const employeeName = String(payload.employee_name || "").trim();
    const departmentId = String(payload.department_id || "").trim() || null;
    const designationId = String(payload.designation_id || "").trim() || null;
    const reportingManagerId =
      String(payload.reporting_manager_id || "").trim() || null;
    const userId = String(payload.user_id || "").trim() || null;

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

    const parentError = await validateHrParents(
      admin,
      companyResult.organizationId,
      id,
      {
        departmentId,
        designationId,
        reportingManagerId,
      }
    );

    if (parentError) {
      return NextResponse.json(
        { error: parentError.error },
        { status: parentError.status }
      );
    }

    const linkedUserError = await validateLinkedUser(
      admin,
      companyResult.organizationId,
      id,
      userId,
    );

    if (linkedUserError) {
      return NextResponse.json(
        { error: linkedUserError.error },
        { status: linkedUserError.status },
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("hr_employees")
      .select("id")
      .eq("organization_id", companyResult.organizationId)
      .ilike("employee_code", employeeCode)
      .neq("id", id)
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

    const { error } = await admin
      .from("hr_employees")
      .update({
        organization_id: companyResult.organizationId,
        company_id: companyId,
        site_id: siteId,
        employee_code: employeeCode,
        employee_name: employeeName,
        email: String(payload.email || "").trim() || null,
        phone: String(payload.phone || "").trim() || null,
        department_id: departmentId,
        designation_id: designationId,
        reporting_manager_id: reportingManagerId,
        user_id: userId,
        date_of_joining: payload.date_of_joining || null,
        employment_type: payload.employment_type || null,
        status: String(payload.status || "active").trim() || "active",
        updated_by: auth.user.id,
        updated_by_name: userName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ employee_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update employee." },
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
    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, organization_id, company_id, site_id")
      .eq("id", id)
      .neq("status", "deleted")
      .maybeSingle();

    if (employeeError) throw employeeError;

    if (!employee) {
      return NextResponse.json({ error: "Employee was not found." }, { status: 404 });
    }

    if (!(await canAccessEmployee(admin, auth, employee))) {
      return NextResponse.json(
        { error: "You do not have access to this employee." },
        { status: 403 }
      );
    }

    const { data: claims, error: claimsError } = await admin
      .from("reimbursement_claims")
      .select("id, status, approval_status")
      .eq("employee_id", id);

    if (claimsError) throw claimsError;

    const hasOpenClaims = (claims || []).some((claim) => {
      const status = String(claim.status || "").trim().toLowerCase();
      const approvalStatus = String(claim.approval_status || "").trim().toLowerCase();

      return (
        !["deleted", "rejected", "closed", "paid"].includes(status) &&
        approvalStatus !== "rejected"
      );
    });

    if (hasOpenClaims) {
      return NextResponse.json(
        { error: "Employee cannot be deleted because open reimbursement claims exist." },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("hr_employees")
      .update({
        status: "deleted",
        updated_by: auth.user.id,
        updated_by_name: userName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete employee." },
      { status: 500 }
    );
  }
}
