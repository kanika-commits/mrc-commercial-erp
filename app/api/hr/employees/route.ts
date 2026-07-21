import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, type ServerPermissionContext } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import { eventDateForField } from "@/lib/hr/employmentHistory";
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

function employmentSnapshot(row: Record<string, any>) {
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

    if (site.company_id && site.company_id !== companyId) {
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
    const departmentId = searchParams.get("department_id")?.trim();
    const designationId = searchParams.get("designation_id")?.trim();
    const employmentType = searchParams.get("employment_type")?.trim();
    const lookupOnly = searchParams.get("lookup") === "1";
    const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
    const pageSizeParam = Number(searchParams.get("page_size") || searchParams.get("pageSize") || 25) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeParam));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAssignments(admin, auth.user.id);
    let query = admin
      .from("hr_employees")
      .select(
        lookupOnly
          ? "id, organization_id, company_id, site_id, employee_code, employee_name, status"
          : "id, organization_id, company_id, site_id, employee_code, employee_name, email, phone, personal_email, personal_phone, date_of_birth, gender, nationality, father_name, mother_name, spouse_name, blood_group, marital_status, current_address, permanent_address, current_address_line1, current_address_line2, current_address_city, current_address_state, current_address_country, current_address_pin_code, permanent_address_line1, permanent_address_line2, permanent_address_city, permanent_address_state, permanent_address_country, permanent_address_pin_code, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, remarks, department_id, designation_id, reporting_manager_id, date_of_joining, employment_type, shift, confirmation_date, notice_period_from, notice_period_to, resignation_date, date_of_exit, exit_remark, status, photo_storage_path, photo_updated_at, created_at, updated_at",
        lookupOnly ? undefined : { count: "exact" }
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
    if (departmentId) query = query.eq("department_id", departmentId);
    if (designationId) query = query.eq("designation_id", designationId);
    if (employmentType) query = query.eq("employment_type", employmentType);
    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(
        `employee_code.ilike.%${search}%,employee_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,personal_email.ilike.%${search}%,personal_phone.ilike.%${search}%`
      );
    }

    if (!lookupOnly) {
      query = query.range(from, to);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const employees = lookupOnly
      ? data || []
      : await Promise.all((data || []).map((employee) => withPhotoSignedUrl(admin, employee)));

    return NextResponse.json({
      employees,
      total: lookupOnly ? employees.length : count || 0,
      page,
      page_size: pageSize,
    });
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
    const companyId = requireText(payload.company_id);
    const siteId = requireText(payload.site_id);
    const employeeCode = requireText(payload.employee_code);
    const employeeName = requireText(payload.employee_name);
    const email = textValue(payload.email);
    const phone = textValue(payload.phone);
    const personalEmail = textValue(payload.personal_email);
    const personalPhone = textValue(payload.personal_phone);
    const departmentId = requireText(payload.department_id);
    const designationId = requireText(payload.designation_id);
    const reportingManagerId =
      textValue(payload.reporting_manager_id);
    const status = requireText(payload.status) || "active";
    const dateOfJoining = dateValue(payload.date_of_joining);
    const dateOfBirth = dateValue(payload.date_of_birth);
    const confirmationDate = dateValue(payload.confirmation_date);
    const noticePeriodFrom = dateValue(payload.notice_period_from);
    const noticePeriodTo = dateValue(payload.notice_period_to);
    const resignationDate = dateValue(payload.resignation_date);
    const relievingDate = dateValue(payload.date_of_exit);

    if (!employeeCode) {
      return NextResponse.json({ error: "Employee code is required." }, { status: 400 });
    }

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
        personal_email: personalEmail,
        personal_phone: personalPhone,
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
        date_of_joining: dateOfJoining,
        employment_type: textValue(payload.employment_type),
        shift: textValue(payload.shift),
        confirmation_date: confirmationDate,
        notice_period_from: noticePeriodFrom,
        notice_period_to: noticePeriodTo,
        resignation_date: resignationDate,
        date_of_exit: relievingDate,
        exit_remark: textValue(payload.exit_remark),
        status,
        created_by: auth.user.id,
        created_by_name: userName(auth),
        created_by_email: auth.user.email || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: companyResult.organizationId,
      companyId,
      siteId,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: data.id,
      action: "create",
      description: `Employee ${employeeName} created.`,
      oldValues: null,
      newValues: data,
      source: "system",
    }, request);

    const joinedEventDate = eventDateForField("date_of_joining", dateOfJoining, new Date().toISOString().slice(0, 10));
    const joinedSnapshot = employmentSnapshot({
      company_id: companyId,
      site_id: siteId,
      department_id: departmentId,
      designation_id: designationId,
      reporting_manager_id: reportingManagerId,
      employment_type: textValue(payload.employment_type),
      shift: textValue(payload.shift),
      status,
      date_of_joining: dateOfJoining,
    });
    const { error: historyError } = await admin.from("employee_employment_history").insert({
      organization_id: companyResult.organizationId,
      employee_id: data.id,
      event_type: "joined",
      event_date: joinedEventDate,
      effective_from: dateOfJoining,
      title: "Joined",
      description: "Initial employment record created with employee profile.",
      source: "system",
      is_manual: false,
      previous_values: null,
      new_values: joinedSnapshot,
      company_id: companyId,
      site_id: siteId,
      department_id: departmentId,
      designation_id: designationId,
      reporting_manager_id: reportingManagerId,
      employment_type: textValue(payload.employment_type),
      shift: textValue(payload.shift),
      employment_status: status,
      created_by: auth.user.id,
      created_by_name: userName(auth),
      created_by_email: auth.user.email || null,
    });

    if (historyError && historyError.code !== "23505") {
      throw historyError;
    }

    return NextResponse.json({ employee_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create employee." },
      { status: 500 }
    );
  }
}
