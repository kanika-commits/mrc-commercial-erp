import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export type UserPermission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export type CurrentUserAccess = {
  user: User | null;
  roleCodes: string[];
  permissions: UserPermission[];
  organizations: string[];
  companies: string[];
  sites: string[];
};

export async function getCurrentUserAccess(): Promise<CurrentUserAccess> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      roleCodes: [],
      permissions: [],
      organizations: [],
      companies: [],
      sites: [],
    };
  }

  if (typeof window !== "undefined") {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      const response = await fetch("/api/admin/current-access", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        return response.json();
      }
    }
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
      .select("organization_id, company_id, site_id")
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

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return {
      user,
      roleCodes,
      permissions: [{ module_code: "*", action_code: "*", allowed: true }],
      organizations: [],
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
    roleCodes,
    permissions,
    organizations: Array.from(
      new Set((accessRows || []).map((row) => row.organization_id).filter(Boolean))
    ),
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
