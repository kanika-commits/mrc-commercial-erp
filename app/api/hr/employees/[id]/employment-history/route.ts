import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  EMPLOYMENT_HISTORY_EVENTS,
  employmentEventLabel,
  type EmploymentHistoryEventType,
} from "@/lib/hr/employmentHistory";
import { insertErpAuditLog } from "@/lib/serverAudit";

const MODULE_CODE = "hr_employees";
const validEventTypes = new Set(EMPLOYMENT_HISTORY_EVENTS.map((event) => event.code));

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

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

function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
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

  if (!isInOrganizationScope(organizationScope, employee.organization_id)) {
    return false;
  }

  if (isGlobalScope(organizationScope)) {
    return true;
  }

  const assignments = await loadActorAssignments(admin, auth.user.id);

  if (assignments.siteIds.length > 0 && !assignments.siteIds.includes(employee.site_id)) {
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

async function validateRelatedRows(
  admin: ReturnType<typeof adminClient>,
  organizationId: string,
  employeeId: string,
  values: {
    companyId?: string | null;
    siteId?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    reportingManagerId?: string | null;
  },
) {
  if (values.companyId) {
    const { data, error } = await admin.from("companies").select("id, organization_id").eq("id", values.companyId).maybeSingle();
    if (error) throw error;
    if (!data || data.organization_id !== organizationId) return "Selected company is not available for this organization.";
  }

  if (values.siteId) {
    const { data, error } = await admin.from("sites").select("id, organization_id, company_id").eq("id", values.siteId).maybeSingle();
    if (error) throw error;
    if (!data || data.organization_id !== organizationId) return "Selected site is not available for this organization.";
    if (values.companyId && data.company_id && data.company_id !== values.companyId) return "Selected site is not available for this company.";
  }

  if (values.departmentId) {
    const { data, error } = await admin.from("hr_departments").select("id, organization_id").eq("id", values.departmentId).maybeSingle();
    if (error) throw error;
    if (!data || data.organization_id !== organizationId) return "Selected department is not available for this organization.";
  }

  if (values.designationId) {
    const { data, error } = await admin.from("hr_designations").select("id, organization_id").eq("id", values.designationId).maybeSingle();
    if (error) throw error;
    if (!data || data.organization_id !== organizationId) return "Selected designation is not available for this organization.";
  }

  if (values.reportingManagerId) {
    if (values.reportingManagerId === employeeId) return "Reporting manager cannot be the same employee.";
    const { data, error } = await admin
      .from("hr_employees")
      .select("id, organization_id")
      .eq("id", values.reportingManagerId)
      .neq("status", "deleted")
      .maybeSingle();
    if (error) throw error;
    if (!data || data.organization_id !== organizationId) return "Selected reporting manager is not available for this organization.";
  }

  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const { searchParams } = new URL(request.url);
    let query = admin
      .from("employee_employment_history")
      .select("*")
      .eq("employee_id", id)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });

    const eventType = searchParams.get("event_type")?.trim();
    const source = searchParams.get("source")?.trim();
    const dateFrom = searchParams.get("date_from")?.trim();
    const dateTo = searchParams.get("date_to")?.trim();

    if (eventType) query = query.eq("event_type", eventType);
    if (source) query = query.eq("source", source);
    if (dateFrom) query = query.gte("event_date", dateFrom);
    if (dateTo) query = query.lte("event_date", dateTo);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ history: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employment history.", 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = adminClient();
    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const payload = await request.json().catch(() => ({}));
    const eventType = textValue(payload.event_type) as EmploymentHistoryEventType | null;
    const eventDate = dateValue(payload.event_date);
    const effectiveFrom = dateValue(payload.effective_from);
    const effectiveTo = dateValue(payload.effective_to);
    const companyId = textValue(payload.company_id);
    const siteId = textValue(payload.site_id);
    const departmentId = textValue(payload.department_id);
    const designationId = textValue(payload.designation_id);
    const reportingManagerId = textValue(payload.reporting_manager_id);
    const today = indiaToday();
    const maxFuture = new Date();
    maxFuture.setFullYear(maxFuture.getFullYear() + 1);
    const maxFutureDate = maxFuture.toISOString().slice(0, 10);

    if (!eventType || !validEventTypes.has(eventType)) return jsonError("Valid event type is required.");
    if (!eventDate) return jsonError("Event date is required.");
    if (isAfterDate(eventDate, maxFutureDate)) return jsonError("Event date is too far in the future.");
    if (effectiveFrom && effectiveTo && isAfterDate(effectiveFrom, effectiveTo)) {
      return jsonError("Effective to date cannot be before effective from date.");
    }

    const relatedError = await validateRelatedRows(admin, employeeResult.employee.organization_id, id, {
      companyId,
      siteId,
      departmentId,
      designationId,
      reportingManagerId,
    });
    if (relatedError) return jsonError(relatedError, 403);

    if (eventType === "transferred") {
      const transferDate = effectiveFrom || eventDate;
      if (!companyId || !siteId || !transferDate) {
        return jsonError("Transferred events require destination company, destination site and effective date.");
      }
      if (transferDate < today || eventDate < today) {
        return jsonError("Transfers cannot be backdated.");
      }
      if (transferDate > today || eventDate > today) {
        const { data: scheduled, error: scheduleError } = await admin.rpc("schedule_hr_employee_transfer", {
          p_employee_id: id,
          p_organization_id: employeeResult.employee.organization_id,
          p_company_id: companyId,
          p_site_id: siteId,
          p_effective_date: transferDate,
          p_actor_id: auth.user.id,
          p_actor_name: userName(auth),
          p_actor_email: auth.user.email || null,
        });
        if (scheduleError) throw scheduleError;
        await insertErpAuditLog(admin, auth.user, {
          organizationId: employeeResult.employee.organization_id,
          companyId,
          siteId,
          moduleCode: MODULE_CODE,
          entityType: "hr_employee_transfer_schedule",
          recordId: scheduled?.id || null,
          action: "create",
          description: `Transfer scheduled for ${transferDate}.`,
          newValues: scheduled,
          source: "api",
        }, request);
        return NextResponse.json({ scheduled_transfer: scheduled }, { status: 201 });
      }
      const { data: transfer, error: transferError } = await admin.rpc("transfer_hr_employee_atomic", {
        p_employee_id: id,
        p_organization_id: employeeResult.employee.organization_id,
        p_company_id: companyId,
        p_site_id: siteId,
        p_transfer_effective_date: transferDate,
        p_actor_id: auth.user.id,
        p_actor_name: userName(auth),
        p_actor_email: auth.user.email || null,
      });
      if (transferError) throw transferError;
      const historyId = transfer?.history_id;
      const history = historyId
        ? await admin.from("employee_employment_history").select("*").eq("id", historyId).single()
        : { data: null, error: null };
      if (history.error) throw history.error;
      return NextResponse.json({ history: history.data, transfer });
    }

    const { data, error } = await admin
      .from("employee_employment_history")
      .insert({
        organization_id: employeeResult.employee.organization_id,
        employee_id: id,
        event_type: eventType,
        event_date: eventDate,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        title: textValue(payload.title) || employmentEventLabel(eventType),
        description: textValue(payload.description),
        reason: textValue(payload.reason),
        source: "manual",
        is_manual: true,
        previous_values: null,
        new_values: {
          company_id: companyId,
          site_id: siteId,
          department_id: departmentId,
          designation_id: designationId,
          reporting_manager_id: reportingManagerId,
          employment_type: textValue(payload.employment_type),
          shift: textValue(payload.shift),
          status: textValue(payload.employment_status),
        },
        company_id: companyId,
        site_id: siteId,
        department_id: departmentId,
        designation_id: designationId,
        reporting_manager_id: reportingManagerId,
        employment_type: textValue(payload.employment_type),
        shift: textValue(payload.shift),
        employment_status: textValue(payload.employment_status),
        source_system: textValue(payload.source_system),
        source_record_id: textValue(payload.source_record_id),
        import_batch_id: textValue(payload.import_batch_id),
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
      moduleCode: "hr_employees",
      entityType: "employee_employment_history",
      recordId: data.id,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "manual_event",
      description: `Manual employment event added: ${data.title || employmentEventLabel(eventType)}.`,
      oldValues: null,
      newValues: data,
      source: "manual",
    }, request);

    return NextResponse.json({ history: data, today });
  } catch (error: any) {
    return jsonError(error.message || "Failed to add employment event.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;
    if (!auth.roleCodes.includes("platform_owner")) {
      return jsonError("Only a Platform Owner can delete manual employment events.", 403);
    }

    const { id } = await context.params;
    const admin = adminClient();
    const employeeResult = await loadAccessibleEmployee(admin, auth, id);
    if ("response" in employeeResult) return employeeResult.response;

    const eventId = new URL(request.url).searchParams.get("event_id")?.trim();
    if (!eventId) return jsonError("Employment event ID is required.");

    const { data, error } = await admin
      .from("employee_employment_history")
      .delete()
      .eq("id", eventId)
      .eq("employee_id", id)
      .eq("organization_id", employeeResult.employee.organization_id)
      .eq("is_manual", true)
      .select("id, title, event_date")
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonError("Only an existing manual employment event in this organization can be deleted.", 404);

    return NextResponse.json({ deleted: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete employment event.", 500);
  }
}
