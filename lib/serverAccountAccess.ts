import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { ACCOUNT_INACTIVE_CODE, INACTIVE_ACCOUNT_MESSAGE } from "@/lib/accountStatus";

export type AccountPermission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export type ActiveAccountContext = {
  user: User;
  roleCodes: string[];
  permissions: AccountPermission[];
  organizations: string[];
  companies: string[];
  sites: string[];
  isGlobalAccess: boolean;
};

type SupabaseAdminClient = {
  from: (table: string) => any;
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function failure(message: string, status: number, code?: string) {
  return {
    response: NextResponse.json({ error: message, code }, { status }),
  } as const;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isBlockedStatus(status: unknown) {
  return ["inactive", "disabled", "deleted"].includes(normalize(status));
}

function isActiveStatus(status: unknown) {
  return normalize(status) === "active";
}

export function inactiveAccountResponse(status = 403) {
  return failure(INACTIVE_ACCOUNT_MESSAGE, status, ACCOUNT_INACTIVE_CODE);
}

export async function loadActiveAccountContext(
  admin: SupabaseAdminClient,
  user: User,
) {
  const [
    profileResult,
    userRolesResult,
    userPermissionsResult,
    accessRowsResult,
  ] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, status").eq("id", user.id).maybeSingle(),
    admin.from("user_roles").select("role_id").eq("user_id", user.id),
    admin
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", user.id),
    admin
      .from("user_access_assignments")
      .select("organization_id, company_id, site_id")
      .eq("user_id", user.id),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (userRolesResult.error) throw userRolesResult.error;
  if (userPermissionsResult.error) throw userPermissionsResult.error;
  if (accessRowsResult.error) throw accessRowsResult.error;

  const profile = profileResult.data;

  if (!profile || isBlockedStatus(profile.status) || !isActiveStatus(profile.status)) {
    return inactiveAccountResponse();
  }

  const roleIds = uniqueValues(
    (userRolesResult.data || []).map((row: { role_id: string | null }) => row.role_id),
  );

  if (roleIds.length === 0) {
    return inactiveAccountResponse();
  }

  const [rolesResult, rolePermissionsResult] = await Promise.all([
    admin.from("roles").select("id, role_code, status").in("id", roleIds),
    admin
      .from("role_permissions")
      .select("module_code, action_code, allowed")
      .in("role_id", roleIds),
  ]);

  if (rolesResult.error) throw rolesResult.error;
  if (rolePermissionsResult.error) throw rolePermissionsResult.error;

  const roles = rolesResult.data || [];

  if (roles.length !== roleIds.length) {
    return inactiveAccountResponse();
  }

  if (roles.some((role: { status?: string | null }) => isBlockedStatus(role.status))) {
    return inactiveAccountResponse();
  }

  const roleCodes = uniqueValues(
    roles.map((role: { role_code: string | null }) => role.role_code),
  );
  const isGlobalAccess = roleCodes.includes("platform_owner");
  const isOrganizationAdmin = roleCodes.includes("super_admin");

  const employeeResult = await admin
    .from("hr_employees")
    .select("id, status")
    .eq("user_id", user.id);

  if (employeeResult.error) throw employeeResult.error;

  const linkedEmployees = employeeResult.data || [];
  const hasLinkedEmployee = linkedEmployees.length > 0;
  const hasActiveLinkedEmployee = linkedEmployees.some((employee: { status?: string | null }) =>
    isActiveStatus(employee.status),
  );

  if (!isGlobalAccess && !isOrganizationAdmin && hasLinkedEmployee && !hasActiveLinkedEmployee) {
    return inactiveAccountResponse();
  }

  if (isGlobalAccess) {
    return {
      user,
      roleCodes,
      permissions: [{ module_code: "*", action_code: "*", allowed: true }],
      organizations: [],
      companies: [],
      sites: [],
      isGlobalAccess: true,
    } satisfies ActiveAccountContext;
  }

  const accessRows = accessRowsResult.data || [];
  const organizations = uniqueValues(
    accessRows.map((row: { organization_id: string | null }) => row.organization_id),
  );
  const companies = uniqueValues(
    accessRows.map((row: { company_id: string | null }) => row.company_id),
  );
  const sites = uniqueValues(accessRows.map((row: { site_id: string | null }) => row.site_id));

  if (organizations.length === 0) {
    return inactiveAccountResponse();
  }

  const organizationResult = await admin
    .from("organizations")
    .select("id, status")
    .in("id", organizations);

  if (organizationResult.error) throw organizationResult.error;

  const activeOrganizationIds = uniqueValues(
    (organizationResult.data || [])
      .filter((organization: { status?: string | null }) => isActiveStatus(organization.status))
      .map((organization: { id: string }) => organization.id),
  );

  if (activeOrganizationIds.length !== organizations.length) {
    return inactiveAccountResponse();
  }

  const permissionMap = new Map<string, AccountPermission>();

  [
    ...((rolePermissionsResult.data || []) as AccountPermission[]),
    ...((userPermissionsResult.data || []) as AccountPermission[]),
  ].forEach((permission) => {
    permissionMap.set(`${permission.module_code}:${permission.action_code}`, permission);
  });

  const addPermission = (moduleCode: string, actionCode: string) => {
    permissionMap.set(`${moduleCode}:${actionCode}`, {
      module_code: moduleCode,
      action_code: actionCode,
      allowed: true,
    });
  };

  const [pmAssignmentsResult, hoAssignmentResult] = await Promise.all([
    admin
      .from("labour_site_configurations")
      .select("id")
      .eq("pm_user_id", user.id)
      .eq("status", "active")
      .limit(1),
    admin
      .from("labour_organization_configurations")
      .select("id")
      .eq("ho_hr_user_id", user.id)
      .eq("status", "active")
      .limit(1),
  ]);
  if (pmAssignmentsResult.error && pmAssignmentsResult.error.code !== "42P01") throw pmAssignmentsResult.error;
  if (hoAssignmentResult.error && hoAssignmentResult.error.code !== "42P01") throw hoAssignmentResult.error;
  if ((pmAssignmentsResult.data || []).length > 0) {
    addPermission("labour_daily_submission", "view");
    addPermission("labour_daily_submission", "pm_approve");
    addPermission("labour_daily_submission", "pm_send_back");
  }
  if ((hoAssignmentResult.data || []).length > 0) {
    addPermission("labour_daily_submission", "view");
    addPermission("labour_daily_submission", "ho_approve");
    addPermission("labour_daily_submission", "ho_send_back");
  }

  return {
    user,
    roleCodes,
    permissions: Array.from(permissionMap.values()),
    organizations,
    companies,
    sites,
    isGlobalAccess: false,
  } satisfies ActiveAccountContext;
}
