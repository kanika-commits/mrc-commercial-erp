import { insertErpAuditLog } from "@/lib/serverAudit";

type AdminClient = any;
type PermissionContext = { user: any };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function profileLabel(profile: any, userId?: string | null) {
  return profile?.email || profile?.full_name || userId || "ERP profile";
}

export async function loadEmployeeLinkOptions(
  admin: AdminClient,
  actorOrganizationIds: string[] | null,
  currentUserId?: string | null,
) {
  let employeeQuery = admin
    .from("hr_employees")
    .select("id, organization_id, employee_code, employee_name, department_id, user_id, status")
    .eq("status", "active")
    .order("employee_name");

  if (actorOrganizationIds?.length) {
    employeeQuery = employeeQuery.in("organization_id", actorOrganizationIds);
  }

  const { data: employees, error: employeeError } = await employeeQuery;
  if (employeeError) throw employeeError;

  const departmentIds = Array.from(
    new Set((employees || []).map((employee: any) => employee.department_id).filter(Boolean)),
  );
  const { data: departments, error: departmentError } = departmentIds.length
    ? await admin
        .from("hr_departments")
        .select("id, department_name")
        .in("id", departmentIds)
    : { data: [], error: null };

  if (departmentError) throw departmentError;

  const departmentById = new Map(
    (departments || []).map((department: any) => [department.id, department.department_name]),
  );

  return (employees || []).map((employee: any) => {
    const linkedElsewhere = Boolean(employee.user_id && employee.user_id !== currentUserId);
    return {
      id: employee.id,
      employee_code: employee.employee_code,
      employee_name: employee.employee_name,
      department_name: departmentById.get(employee.department_id) || null,
      user_id: employee.user_id || null,
      already_linked: linkedElsewhere,
      selectable: !linkedElsewhere,
    };
  });
}

async function loadProfileForAudit(admin: AdminClient, userId?: string | null) {
  if (!userId) return null;
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function profileAuditValue(profile: any) {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email || null,
    full_name: profile.full_name || null,
    status: profile.status || null,
  };
}

export async function validateEmployeeCanLinkToUser(
  admin: AdminClient,
  input: {
    employeeId?: string | null;
    userId: string;
    actorOrganizationIds: string[] | null;
  },
) {
  const employeeId = text(input.employeeId);
  if (!employeeId) {
    return { error: "Linked Employee is required.", status: 400 } as const;
  }

  let employeeQuery = admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, employee_code, employee_name, user_id, status")
    .eq("id", employeeId)
    .eq("status", "active")
    .maybeSingle();

  if (input.actorOrganizationIds?.length) {
    employeeQuery = employeeQuery.in("organization_id", input.actorOrganizationIds);
  }

  const { data: employee, error: employeeError } = await employeeQuery;
  if (employeeError) throw employeeError;

  if (!employee) {
    return { error: "Selected active employee was not found or is outside your scope.", status: 404 } as const;
  }

  if (employee.user_id && employee.user_id !== input.userId) {
    return { error: "This employee is already linked to another ERP user.", status: 409 } as const;
  }

  const { data: duplicate, error: duplicateError } = await admin
    .from("hr_employees")
    .select("id, employee_code, employee_name")
    .eq("user_id", input.userId)
    .neq("id", employee.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (duplicateError) throw duplicateError;

  if (duplicate) {
    return { error: "This ERP user is already linked to another active employee.", status: 409 } as const;
  }

  return { employee } as const;
}

export async function loadLinkedEmployeeForUser(
  admin: AdminClient,
  userId: string,
  actorOrganizationIds: string[] | null,
) {
  let query = admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, employee_code, employee_name, department_id, user_id, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (actorOrganizationIds?.length) {
    query = query.in("organization_id", actorOrganizationIds);
  }

  const { data: employee, error } = await query;
  if (error) throw error;
  return employee || null;
}

export async function setUserEmployeeLink(
  admin: AdminClient,
  request: Request,
  auth: PermissionContext,
  input: {
    userId: string;
    employeeId?: string | null;
    actorOrganizationIds: string[] | null;
    requireEmployee?: boolean;
  },
) {
  const nextEmployeeId = text(input.employeeId);

  if (input.requireEmployee && !nextEmployeeId) {
    return { error: "Linked Employee is required.", status: 400 } as const;
  }

  const currentEmployee = await loadLinkedEmployeeForUser(
    admin,
    input.userId,
    input.actorOrganizationIds,
  );

  if (!nextEmployeeId) {
    if (!currentEmployee) return { linked_employee_id: null, link_changed: false } as const;

    const previousProfile = await loadProfileForAudit(admin, input.userId);
    const { error: unlinkError } = await admin
      .from("hr_employees")
      .update({ user_id: null, updated_by: auth.user.id, updated_at: new Date().toISOString() })
      .eq("id", currentEmployee.id);

    if (unlinkError) throw unlinkError;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: currentEmployee.organization_id,
      companyId: currentEmployee.company_id,
      siteId: currentEmployee.site_id,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: currentEmployee.id,
      action: "erp_profile_unlinked",
      description: `Employee ${currentEmployee.employee_code} unlinked from ERP profile ${profileLabel(previousProfile, input.userId)} from Admin Users.`,
      oldValues: {
        employee_id: currentEmployee.id,
        employee_code: currentEmployee.employee_code,
        employee_name: currentEmployee.employee_name,
        profile: profileAuditValue(previousProfile),
      },
      newValues: {
        employee_id: currentEmployee.id,
        employee_code: currentEmployee.employee_code,
        employee_name: currentEmployee.employee_name,
        profile: null,
      },
      source: "system",
    }, request);

    return { linked_employee_id: null, link_changed: true } as const;
  }

  const validation = await validateEmployeeCanLinkToUser(admin, {
    employeeId: nextEmployeeId,
    userId: input.userId,
    actorOrganizationIds: input.actorOrganizationIds,
  });

  if ("error" in validation) return validation;

  const nextEmployee = validation.employee;
  if (currentEmployee?.id === nextEmployee.id) {
    return { linked_employee_id: nextEmployee.id, link_changed: false } as const;
  }

  const previousProfile = await loadProfileForAudit(admin, input.userId);

  if (currentEmployee) {
    const { error: unlinkPreviousError } = await admin
      .from("hr_employees")
      .update({ user_id: null, updated_by: auth.user.id, updated_at: new Date().toISOString() })
      .eq("id", currentEmployee.id);

    if (unlinkPreviousError) throw unlinkPreviousError;
  }

  const { error: linkError } = await admin
    .from("hr_employees")
    .update({ user_id: input.userId, updated_by: auth.user.id, updated_at: new Date().toISOString() })
    .eq("id", nextEmployee.id);

  if (linkError) throw linkError;

  const action = currentEmployee ? "erp_profile_changed" : "erp_profile_linked";
  await insertErpAuditLog(admin, auth.user, {
    organizationId: nextEmployee.organization_id,
    companyId: nextEmployee.company_id,
    siteId: nextEmployee.site_id,
    moduleCode: "hr_employees",
    entityType: "hr_employee",
    recordId: nextEmployee.id,
    action,
    description: `Employee ${nextEmployee.employee_code} linked to ERP profile ${profileLabel(previousProfile, input.userId)} from Admin Users.`,
    oldValues: currentEmployee
      ? {
          previous_employee_id: currentEmployee.id,
          previous_employee_code: currentEmployee.employee_code,
          previous_employee_name: currentEmployee.employee_name,
        }
      : null,
    newValues: {
      employee_id: nextEmployee.id,
      employee_code: nextEmployee.employee_code,
      employee_name: nextEmployee.employee_name,
      profile: profileAuditValue(previousProfile),
    },
    source: "system",
  }, request);

  return { linked_employee_id: nextEmployee.id, link_changed: true } as const;
}
