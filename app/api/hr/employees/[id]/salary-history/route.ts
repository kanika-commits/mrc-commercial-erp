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
  return snapshot;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, SALARY_MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const { data, error } = await admin
      .from("employee_salary_history")
      .select("*")
      .eq("employee_id", id)
      .order("effective_from", { ascending: false })
      .order("revision_no", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ salaryHistory: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load salary history.", 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, SALARY_MODULE_CODE, "add");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const revisionType = textValue(payload.revision_type) as SalaryRevisionType | null;
    const effectiveFrom = dateValue(payload.effective_from);

    if (!revisionType || !validRevisionTypes.has(revisionType)) return jsonError("Valid revision type is required.");
    if (!effectiveFrom) return jsonError("Effective from date is required.");

    const maxFuture = new Date();
    maxFuture.setFullYear(maxFuture.getFullYear() + 1);
    if (isAfterDate(effectiveFrom, maxFuture.toISOString().slice(0, 10))) {
      return jsonError("Effective date is too far in the future.");
    }

    const amounts = amountsFromPayload(payload);

    const { data: currentRecord, error: currentError } = await admin
      .from("employee_salary_history")
      .select("*")
      .eq("employee_id", id)
      .eq("status", "current")
      .maybeSingle();

    if (currentError) throw currentError;

    if (currentRecord?.effective_from && !isAfterDate(effectiveFrom, currentRecord.effective_from)) {
      return jsonError("Effective date must be after the current salary effective date.", 409);
    }

    const { data: latestRows, error: latestError } = await admin
      .from("employee_salary_history")
      .select("revision_no")
      .eq("employee_id", id)
      .order("revision_no", { ascending: false })
      .limit(1);

    if (latestError) throw latestError;

    const nextRevisionNo = Number(latestRows?.[0]?.revision_no || 0) + 1;

    if (currentRecord) {
      const closeDate = new Date(`${effectiveFrom}T00:00:00Z`);
      closeDate.setUTCDate(closeDate.getUTCDate() - 1);
      const { error: closeError } = await admin
        .from("employee_salary_history")
        .update({
          status: "historical",
          effective_to: closeDate.toISOString().slice(0, 10),
          updated_by: auth.user.id,
          updated_by_name: userName(auth),
          updated_by_email: auth.user.email || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentRecord.id);

      if (closeError) throw closeError;
    }

    const newValues = {
      ...amounts,
      revision_type: revisionType,
      effective_from: effectiveFrom,
      status: "current",
    };

    const { data, error } = await admin
      .from("employee_salary_history")
      .insert({
        organization_id: employeeResult.employee.organization_id,
        employee_id: id,
        revision_no: nextRevisionNo,
        revision_type: revisionType,
        effective_from: effectiveFrom,
        effective_to: null,
        ...amounts,
        reason: textValue(payload.reason),
        remarks: textValue(payload.remarks),
        source: textValue(payload.source) || "manual",
        source_system: textValue(payload.source_system),
        source_record_id: textValue(payload.source_record_id),
        import_batch_id: textValue(payload.import_batch_id),
        status: "current",
        previous_values: salarySnapshot(currentRecord),
        new_values: newValues,
        created_by: auth.user.id,
        created_by_name: userName(auth),
        created_by_email: auth.user.email || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employeeResult.employee.organization_id,
      companyId: employeeResult.employee.company_id,
      siteId: employeeResult.employee.site_id,
      moduleCode: "hr_salary",
      entityType: "employee_salary_history",
      recordId: data.id,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "salary_revision",
      description: "Salary revision added.",
      oldValues: salarySnapshot(currentRecord),
      newValues: data,
      source: "system",
    }, request);

    return NextResponse.json({ salary: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save salary revision.", 500);
  }
}
