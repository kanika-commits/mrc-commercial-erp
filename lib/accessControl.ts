import { supabase } from "@/lib/supabase";

export type UserPermission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export async function getCurrentUserAccess() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      permissions: [],
      companies: [],
      sites: [],
    };
  }

  const [
    { data: userRoles },
    { data: userPermissionRows },
    { data: accessRows },
  ] = await Promise.all([
    supabase.from("user_roles").select("role_id").eq("user_id", user.id),

    supabase
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", user.id),

    supabase
      .from("user_access_assignments")
      .select("company_id, site_id")
      .eq("user_id", user.id),
  ]);

  const roleIds = (userRoles || []).map((r) => r.role_id).filter(Boolean);

  let roleCodes: string[] = [];
  let rolePermissionRows: UserPermission[] = [];

  if (roleIds.length > 0) {
    const [{ data: roles }, { data: rolePermissions }] = await Promise.all([
      supabase.from("roles").select("role_code").in("id", roleIds),

      supabase
        .from("role_permissions")
        .select("module_code, action_code, allowed")
        .in("role_id", roleIds),
    ]);

    roleCodes = (roles || []).map((r) => r.role_code).filter(Boolean);
    rolePermissionRows = rolePermissions || [];
  }

  if (roleCodes.includes("platform_owner")) {
    return {
      user,
      permissions: [{ module_code: "*", action_code: "*", allowed: true }],
      companies: [],
      sites: [],
    };
  }

  const permissionMap = new Map<string, UserPermission>();

  [...rolePermissionRows, ...(userPermissionRows || [])].forEach((permission) => {
    permissionMap.set(
      `${permission.module_code}:${permission.action_code}`,
      permission
    );
  });

  const permissions = Array.from(permissionMap.values());

  return {
    user,
    permissions,
    companies: Array.from(
      new Set((accessRows || []).map((row) => row.company_id).filter(Boolean))
    ),
    sites: Array.from(
      new Set((accessRows || []).map((row) => row.site_id).filter(Boolean))
    ),
  };
}

export function can(
  permissions: UserPermission[],
  moduleCode: string,
  actionCode: string
) {
  return permissions.some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode &&
          permission.action_code === actionCode))
  );
}