import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  EMPLOYMENT_HISTORY_FIELD_LABELS,
  EMPLOYMENT_HISTORY_FIELDS,
  eventDateForField,
  employmentEventLabel,
  mapEmploymentEventType,
  valuesDiffer,
} from "@/lib/hr/employmentHistory";
import { insertErpAuditLog } from "@/lib/serverAudit";

const MODULE_CODE = "hr_employees";
const PHOTO_BUCKET = "employee-photos";

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

function textValue(value: unknown) {
  return String(value || "").trim() || null;
}

function requireText(value: unknown) {
  return String(value || "").trim();
}

function profileAuditValue(profile?: any | null) {
  if (!profile) return null;
  return {
    id: profile.id || null,
    email: profile.email || null,
    status: profile.status || null,
  };
}

function dateValue(value: unknown) {
  return String(value || "").trim() || null;
}

function isAfterDate(left: string, right: string) {
  return new Date(`${left}T00:00:00Z`).getTime() > new Date(`${right}T00:00:00Z`).getTime();
}

function validateEmployeeDates(values: {
  dateOfBirth?: string | null;
  dateOfJoining?: string | null;
  confirmationDate?: string | null;
  noticePeriodFrom?: string | null;
  noticePeriodTo?: string | null;
  resignationDate?: string | null;
  relievingDate?: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);

  if (values.dateOfBirth && isAfterDate(values.dateOfBirth, today)) {
    return "Date of birth cannot be in the future.";
  }

  if (!values.dateOfJoining) {
    return "Joining date is required.";
  }

  const datedFields = [
    { label: "Confirmation date", value: values.confirmationDate },
    { label: "Notice period start date", value: values.noticePeriodFrom },
    { label: "Resignation date", value: values.resignationDate },
    { label: "Relieving date", value: values.relievingDate },
  ];

  for (const field of datedFields) {
    if (field.value && isAfterDate(values.dateOfJoining, field.value)) {
      return `${field.label} cannot be before joining date.`;
    }
  }

  if (
    values.noticePeriodFrom &&
    values.noticePeriodTo &&
    isAfterDate(values.noticePeriodFrom, values.noticePeriodTo)
  ) {
    return "Notice period end date cannot be before notice period start date.";
  }

  return null;
}

function employmentState(row: Record<string, any>): Record<string, string | null> {
  return {
    company_id: row.company_id || null,
    site_id: row.site_id || null,
    department_id: row.department_id || null,
    designation_id: row.designation_id || null,
    reporting_manager_id: row.reporting_manager_id || null,
    employment_type: row.employment_type || null,
    shift: row.shift || null,
    status: row.status || null,
    date_of_joining: row.date_of_joining || null,
    confirmation_date: row.confirmation_date || null,
    notice_period_from: row.notice_period_from || null,
    notice_period_to: row.notice_period_to || null,
    resignation_date: row.resignation_date || null,
    date_of_exit: row.date_of_exit || null,
    exit_remark: row.exit_remark || null,
  };
}

async function withPhotoSignedUrl(admin: ReturnType<typeof adminClient>, employee: any) {
  if (!employee?.photo_storage_path) {
    return { ...employee, photo_signed_url: null };
  }

  const { data, error } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(employee.photo_storage_path, 60 * 10);

  return {
    ...employee,
    photo_signed_url: error ? null : data?.signedUrl || null,
  };
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

    if (!site || site.organization_id !== company.organization_id) {
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
  currentUserId: string | null | undefined,
  userId?: string | null,
) {
  if (!userId) return null;
  if (userId === currentUserId) return null;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, email, full_name, status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!profile || profile.status !== "active") {
    return { error: "Selected ERP profile is not active.", status: 403 } as const;
  }

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
    return { error: "This ERP profile is already linked to another employee.", status: 409 } as const;
  }

  return null;
}

async function loadProfileForAudit(admin: ReturnType<typeof adminClient>, userId?: string | null) {
  if (!userId) return null;
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
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

    return NextResponse.json({ employee: await withPhotoSignedUrl(admin, employee) });
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
      .select("*")
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

    const companyId = requireText(payload.company_id);
    const siteId = requireText(payload.site_id);
    const employeeCode = requireText(existing.employee_code);
    const employeeName = requireText(payload.employee_name);
    const departmentId = requireText(payload.department_id);
    const designationId = requireText(payload.designation_id);
    const reportingManagerId =
      textValue(payload.reporting_manager_id);
    const userId = textValue(payload.user_id);
    const dateOfJoining = dateValue(payload.date_of_joining);
    const dateOfBirth = dateValue(payload.date_of_birth);
    const confirmationDate = dateValue(payload.confirmation_date);
    const noticePeriodFrom = dateValue(payload.notice_period_from);
    const noticePeriodTo = dateValue(payload.notice_period_to);
    const resignationDate = dateValue(payload.resignation_date);
    const relievingDate = dateValue(payload.date_of_exit);
    const transferEffectiveDate = dateValue(payload.transfer_effective_date);
    const assignmentChanged = existing.company_id !== companyId || existing.site_id !== siteId;

    if (!employeeName) {
      return NextResponse.json({ error: "Employee name is required." }, { status: 400 });
    }

    if (!siteId) {
      return NextResponse.json({ error: "Site is required." }, { status: 400 });
    }

    if (!departmentId) {
      return NextResponse.json({ error: "Department is required." }, { status: 400 });
    }

    if (!designationId) {
      return NextResponse.json({ error: "Designation is required." }, { status: 400 });
    }

    const dateError = validateEmployeeDates({
      dateOfBirth,
      dateOfJoining,
      confirmationDate,
      noticePeriodFrom,
      noticePeriodTo,
      resignationDate,
      relievingDate,
    });

    if (dateError) {
      return NextResponse.json({ error: dateError }, { status: 400 });
    }

    if (assignmentChanged) {
      if (!transferEffectiveDate) {
        return NextResponse.json({ error: "Transfer effective date is required when Company or Site changes." }, { status: 400 });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (isAfterDate(transferEffectiveDate, today)) {
        return NextResponse.json({ error: "Future-dated transfers are not supported. Use today or an earlier date." }, { status: 400 });
      }
      if (dateOfJoining && isAfterDate(dateOfJoining, transferEffectiveDate)) {
        return NextResponse.json({ error: "Transfer effective date cannot be before the employee's joining date." }, { status: 400 });
      }
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
      existing.user_id,
      userId,
    );

    if (linkedUserError) {
      return NextResponse.json(
        { error: linkedUserError.error },
        { status: linkedUserError.status },
      );
    }

    const updatePayload = {
      organization_id: companyResult.organizationId,
      company_id: companyId,
      site_id: siteId,
      employee_code: existing.employee_code,
      employee_name: employeeName,
      email: textValue(payload.email),
      phone: textValue(payload.phone),
      personal_email: textValue(payload.personal_email),
      personal_phone: textValue(payload.personal_phone),
      date_of_birth: dateOfBirth,
      gender: textValue(payload.gender),
      nationality: textValue(payload.nationality),
      father_name: textValue(payload.father_name),
      mother_name: textValue(payload.mother_name),
      spouse_name: textValue(payload.spouse_name),
      blood_group: textValue(payload.blood_group),
      marital_status: textValue(payload.marital_status),
      current_address: textValue(payload.current_address),
      permanent_address: textValue(payload.permanent_address),
      current_address_line1: textValue(payload.current_address_line1),
      current_address_line2: textValue(payload.current_address_line2),
      current_address_city: textValue(payload.current_address_city),
      current_address_state: textValue(payload.current_address_state),
      current_address_country: textValue(payload.current_address_country),
      current_address_pin_code: textValue(payload.current_address_pin_code),
      permanent_address_line1: textValue(payload.permanent_address_line1),
      permanent_address_line2: textValue(payload.permanent_address_line2),
      permanent_address_city: textValue(payload.permanent_address_city),
      permanent_address_state: textValue(payload.permanent_address_state),
      permanent_address_country: textValue(payload.permanent_address_country),
      permanent_address_pin_code: textValue(payload.permanent_address_pin_code),
      emergency_contact_name: textValue(payload.emergency_contact_name),
      emergency_contact_phone: textValue(payload.emergency_contact_phone),
      emergency_contact_relationship: textValue(payload.emergency_contact_relationship),
      remarks: textValue(payload.remarks),
      department_id: departmentId,
      designation_id: designationId,
      reporting_manager_id: reportingManagerId,
      user_id: userId,
      date_of_joining: dateOfJoining,
      employment_type: textValue(payload.employment_type),
      shift: textValue(payload.shift),
      confirmation_date: confirmationDate,
      notice_period_from: noticePeriodFrom,
      notice_period_to: noticePeriodTo,
      resignation_date: resignationDate,
      date_of_exit: relievingDate,
      exit_remark: textValue(payload.exit_remark),
      status: requireText(payload.status) || "active",
      updated_by: auth.user.id,
      updated_by_name: userName(auth),
      updated_by_email: auth.user.email || null,
      updated_at: new Date().toISOString(),
    };

    if (assignmentChanged) {
      const { error: transferError } = await admin.rpc("transfer_hr_employee_atomic", {
        p_employee_id: id,
        p_organization_id: companyResult.organizationId,
        p_company_id: companyId,
        p_site_id: siteId,
        p_transfer_effective_date: transferEffectiveDate,
        p_actor_id: auth.user.id,
        p_actor_name: userName(auth),
        p_actor_email: auth.user.email || null,
      });
      if (transferError) throw transferError;
    }

    const { error } = await admin
      .from("hr_employees")
      .update(updatePayload)
      .eq("id", id);

    if (error) throw error;

    const previousState = employmentState(existing);
    const nextState = employmentState(updatePayload);
    const changedFields = EMPLOYMENT_HISTORY_FIELDS.filter((field) =>
      valuesDiffer(previousState[field], nextState[field]),
    );

    if (changedFields.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const historyFields = assignmentChanged
        ? changedFields.filter((field) => field !== "company_id" && field !== "site_id")
        : changedFields;
      const historyRows = historyFields.map((field) => {
        const eventType = mapEmploymentEventType(field, previousState[field], nextState[field]);
        return {
          organization_id: companyResult.organizationId,
          employee_id: id,
          event_type: eventType,
          event_date: eventDateForField(field, nextState[field], today),
          effective_from: ["date_of_joining", "confirmation_date", "resignation_date", "date_of_exit"].includes(field)
            ? nextState[field]
            : today,
          title: employmentEventLabel(eventType),
          description: `${EMPLOYMENT_HISTORY_FIELD_LABELS[field] || field} changed.`,
          source: "system",
          is_manual: false,
          previous_values: { [field]: previousState[field] },
          new_values: { [field]: nextState[field] },
          company_id: nextState.company_id,
          site_id: nextState.site_id,
          department_id: nextState.department_id,
          designation_id: nextState.designation_id,
          reporting_manager_id: nextState.reporting_manager_id,
          employment_type: nextState.employment_type,
          shift: nextState.shift,
          employment_status: nextState.status,
          created_by: auth.user.id,
          created_by_name: userName(auth),
          created_by_email: auth.user.email || null,
        };
      });

      const { error: historyError } = historyRows.length
        ? await admin.from("employee_employment_history").insert(historyRows)
        : { error: null };

      if (historyError) throw historyError;
    }

    const profileLinkChanged = (existing.user_id || null) !== (userId || null);
    const [previousProfile, nextProfile] = profileLinkChanged
      ? await Promise.all([
          loadProfileForAudit(admin, existing.user_id),
          loadProfileForAudit(admin, userId),
        ])
      : [null, null];

    await insertErpAuditLog(admin, auth.user, {
      organizationId: companyResult.organizationId,
      companyId,
      siteId,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: id,
      action: changedFields.length > 0 ? "employment_change" : "update",
      description: changedFields.length > 0
        ? `Employee employment fields changed: ${changedFields.join(", ")}.`
        : `Employee ${employeeName} updated.`,
      oldValues: changedFields.length > 0 ? previousState : existing,
      newValues: changedFields.length > 0 ? nextState : updatePayload,
      source: "system",
    }, request);

    if (profileLinkChanged) {
      const action = existing.user_id && userId
        ? "erp_profile_changed"
        : userId
          ? "erp_profile_linked"
          : "erp_profile_unlinked";
      await insertErpAuditLog(admin, auth.user, {
        organizationId: companyResult.organizationId,
        companyId,
        siteId,
        moduleCode: "hr_employees",
        entityType: "hr_employee",
        recordId: id,
        action,
        description: userId
          ? `Employee ${employeeCode} linked to ERP profile ${nextProfile?.email || userId}.`
          : `Employee ${employeeCode} unlinked from ERP profile ${previousProfile?.email || existing.user_id}.`,
        oldValues: {
          employee_id: id,
          employee_code: existing.employee_code,
          employee_name: existing.employee_name,
          profile: profileAuditValue(previousProfile),
        },
        newValues: {
          employee_id: id,
          employee_code: employeeCode,
          employee_name: employeeName,
          profile: profileAuditValue(nextProfile),
        },
        source: "system",
      }, request);
    }

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

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: id,
      action: "delete",
      description: "Employee marked as deleted.",
      oldValues: employee,
      newValues: { status: "deleted" },
      source: "system",
    }, request);

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete employee." },
      { status: 500 }
    );
  }
}
