import { supabase } from "@/lib/supabase";

export type UserPermission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};export async function getCurrentUserAccess() {
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

  const [{ data: userRoles }, { data: userPermissionRows }, { data: accessRows }] =
  await Promise.all([
    supabase
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id)
      .limit(1),

      supabase
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", user.id),

      supabase
        .from("user_access_assignments")
        .select("company_id, site_id")
        .eq("user_id", user.id),
    ]);

  let roleCode = "";

  const userRole = userRoles?.[0];

if (userRole?.role_id) {
    const { data: roleData } = await supabase
      .from("roles")
      .select("role_code")
      .eq("id", userRole.role_id)
      .maybeSingle();

    roleCode = roleData?.role_code || "";
  }

  if (roleCode === "platform_owner") {
    return {
      user,
      permissions: [{ module_code: "*", action_code: "*", allowed: true }],
      companies: [],
      sites: [],
    };
  }

  const permissions: UserPermission[] = userPermissionRows || [];

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