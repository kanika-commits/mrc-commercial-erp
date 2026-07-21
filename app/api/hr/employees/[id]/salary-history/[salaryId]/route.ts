import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  SALARY_AMOUNT_FIELDS,
  SALARY_REVISION_TYPES,
  parseSalaryAmount,
  type SalaryRevisionType,
} from "@/lib/hr/salaryHistory";
import { insertErpAuditLog } from "@/lib/serverAudit";

const SALARY_MODULE_CODE = "hr_salary";
const validRevisionTypes = new Set(SALARY_REVISION_TYPES.map((type) => type.code));

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(supabaseUrl, serviceRoleKey);
}

function userName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "HR User"
  );
}

function textValue(value: unknown) {
  return String(value || "").trim() || null;
}

function dateValue(value: unknown) {
  return String(value || "").trim() || null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isAfterDate(left: string, right: string) {
  return new Date(`${left}T00:00:00Z`).getTime() > new Date(`${right}T00:00:00Z`).getTime();
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(new Set((data || []).map((row) => row.company_id).filter(Boolean))) as string[],
    siteIds: Array.from(new Set((data || []).map((row) => row.site_id).filter(Boolean))) as string[],
  };
}

async function canAccessEmployee(admin: ReturnType<typeof adminClient>, auth: ServerPermissionContext, employee: any) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (!isInOrganizationScope(organizationScope, employee.organization_id)) return false;
  if (isGlobalScope(organizationScope)) return true;

  const assignments = await loadActorAssignments(admin, auth.user.id);
  if (assignments.siteIds.length > 0 && !assignments.siteIds.includes(employee.site_id)) return false;
  if (assignments.siteIds.length === 0 && assignments.companyIds.length > 0 && !assignments.companyIds.includes(employee.company_id)) return false;

  return true;
}

async function loadAccessibleEmployee(admin: ReturnType<typeof adminClient>, auth: ServerPermissionContext, id: string) {
  const { data: employee, error } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id")
    .eq("id", id)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) throw error;
  if (!employee) return { response: jsonError("Employee was not found.", 404) } as const;
  if (!(await canAccessEmployee(admin, auth, employee))) {
    return { response: jsonError("You do not have access to this employee.", 403) } as const;
  }

  return { employee } as const;
}

function amountsFromPayload(payload: Record<string, unknown>) {
  const amounts: Record<string, number | null> = {};
  for (const field of SALARY_AMOUNT_FIELDS) {
    amounts[field] = parseSalaryAmount(payload[field]);
  }
  return amounts;
}

function salarySnapshot(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const snapshot: Record<string, unknown> = {};
  for (const field of SALARY_AMOUNT_FIELDS) {
    snapshot[field] = row[field] ?? null;
  }
  snapshot.revision_type = row.revision_type ?? null;
  snapshot.effective_from = row.effective_from ?? null;
  snapshot.effective_to = row.effective_to ?? null;
  snapshot.status = row.status ?? null;
  snapshot.reason = row.reason ?? null;
  snapshot.remarks = row.remarks ?? null;
  return snapshot;
}

async function loadSalaryRow(admin: ReturnType<typeof adminClient>, employeeId: string, salaryId: string) {
  const { data, error } = await admin
    .from("employee_salary_history")
    .select("*")
    .eq("id", salaryId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { response: jsonError("Salary revision was not found.", 404) } as const;
  return { salary: data } as const;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; salaryId: string }> },
) {
  try {
    const auth = await requirePermission(request, SALARY_MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id, salaryId } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();

    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const salaryResult = await loadSalaryRow(admin, id, salaryId);
    if ("response" in salaryResult) return salaryResult.response;

    const revisionType = textValue(payload.revision_type) as SalaryRevisionType | null;
    const effectiveFrom = dateValue(payload.effective_from);
    const effectiveTo = dateValue(payload.effective_to);

    if (!revisionType || !validRevisionTypes.has(revisionType)) return jsonError("Valid revision type is required.");
    if (!effectiveFrom) return jsonError("Effective from date is required.");
    if (effectiveTo && isAfterDate(effectiveFrom, effectiveTo)) {
      return jsonError("Effective to date cannot be before effective from date.");
    }

    const amounts = amountsFromPayload(payload);
    const previousValues = salarySnapshot(salaryResult.salary);
    const updateValues = {
      revision_type: revisionType,
      effective_from: effectiveFrom,
      effective_to: salaryResult.salary.status === "current" ? null : effectiveTo,
      ...amounts,
      reason: textValue(payload.reason),
      remarks: textValue(payload.remarks),
      new_values: {
        ...amounts,
        revision_type: revisionType,
        effective_from: effectiveFrom,
        effective_to: salaryResult.salary.status === "current" ? null : effectiveTo,
        status: salaryResult.salary.status,
      },
      previous_values: previousValues,
      updated_by: auth.user.id,
      updated_by_name: userName(auth),
      updated_by_email: auth.user.email || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("employee_salary_history")
      .update(updateValues)
      .eq("id", salaryId)
      .select("*")
      .single();

    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employeeResult.employee.organization_id,
      companyId: employeeResult.employee.company_id,
      siteId: employeeResult.employee.site_id,
      moduleCode: "hr_salary",
      entityType: "employee_salary_history",
      recordId: salaryId,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "salary_revision",
      description: "Salary revision updated.",
      oldValues: previousValues,
      newValues: data,
      source: "system",
    }, request);

    return NextResponse.json({ salary: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update salary revision.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; salaryId: string }> },
) {
  try {
    const auth = await requirePermission(request, SALARY_MODULE_CODE, "delete");
    if ("response" in auth) return auth.response;

    const { id, salaryId } = await context.params;
    const admin = adminClient();

    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const salaryResult = await loadSalaryRow(admin, id, salaryId);
    if ("response" in salaryResult) return salaryResult.response;

    if (salaryResult.salary.status === "current") {
      return jsonError("Current salary revision cannot be deleted. Add a replacement revision first.", 409);
    }

    const { error } = await admin
      .from("employee_salary_history")
      .delete()
      .eq("id", salaryId);

    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employeeResult.employee.organization_id,
      companyId: employeeResult.employee.company_id,
      siteId: employeeResult.employee.site_id,
      moduleCode: "hr_salary",
      entityType: "employee_salary_history",
      recordId: salaryId,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "delete",
      description: "Historical salary revision deleted.",
      oldValues: salaryResult.salary,
      newValues: null,
      source: "system",
    }, request);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete salary revision.", 500);
  }
}
