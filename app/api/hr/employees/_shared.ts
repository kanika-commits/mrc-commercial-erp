import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

export const HR_EMPLOYEES_MODULE_CODE = "hr_employees";

export function hrAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function loadActorAssignments(
  admin: ReturnType<typeof hrAdminClient>,
  userId: string,
) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean)),
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean)),
    ) as string[],
  };
}

export async function canAccessHrEmployee(
  admin: ReturnType<typeof hrAdminClient>,
  auth: ServerPermissionContext,
  employee: {
    organization_id?: string | null;
    company_id?: string | null;
    site_id?: string | null;
  },
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
    (!employee.site_id || !assignments.siteIds.includes(employee.site_id))
  ) {
    return false;
  }

  if (
    assignments.siteIds.length === 0 &&
    assignments.companyIds.length > 0 &&
    (!employee.company_id || !assignments.companyIds.includes(employee.company_id))
  ) {
    return false;
  }

  return true;
}

export async function resolveCurrentLinkedEmployee(
  request: Request,
  moduleCode = HR_EMPLOYEES_MODULE_CODE,
  actionCode = "view",
) {
  const auth = await requirePermission(request, moduleCode, actionCode);

  if ("response" in auth) return auth;

  const admin = hrAdminClient();
  const { data: employee, error } = await admin
    .from("hr_employees")
    .select(
      "id, organization_id, company_id, site_id, employee_code, employee_name, email, phone, department_id, designation_id, reporting_manager_id, user_id, date_of_joining, employment_type, status",
    )
    .eq("user_id", auth.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;

  if (!employee) {
    return {
      response: NextResponse.json(
        { error: "No linked active employee was found for the current user." },
        { status: 404 },
      ),
    } as const;
  }

  if (!(await canAccessHrEmployee(admin, auth, employee))) {
    return {
      response: NextResponse.json(
        { error: "You do not have access to this employee." },
        { status: 403 },
      ),
    } as const;
  }

  return { auth, admin, employee } as const;
}
