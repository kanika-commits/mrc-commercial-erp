import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export type ServerPermission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export type ServerPermissionContext = {
  user: User;
  roleCodes: string[];
  permissions: ServerPermission[];
};

function hasPermission(
  permissions: ServerPermission[],
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

function failure(message: string, status: number) {
  return {
    response: NextResponse.json({ error: message }, { status }),
  } as const;
}

async function loadPermissionContext(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return failure("Missing auth token.", 401);
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return failure("User not found.", 401);
  }

  const [{ data: userRoles, error: userRolesError }, { data: userPermissions, error: userPermissionsError }] =
    await Promise.all([
      admin.from("user_roles").select("role_id").eq("user_id", user.id),
      admin
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", user.id),
    ]);

  if (userRolesError) throw userRolesError;
  if (userPermissionsError) throw userPermissionsError;

  const roleIds = (userRoles || [])
    .map((row: { role_id: string | null }) => row.role_id)
    .filter(Boolean);

  let roleCodes: string[] = [];
  let rolePermissions: ServerPermission[] = [];

  if (roleIds.length > 0) {
    const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] =
      await Promise.all([
        admin.from("roles").select("role_code").in("id", roleIds),
        admin
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds),
      ]);

    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;

    roleCodes = (roles || [])
      .map((role: { role_code: string | null }) => role.role_code)
      .filter((roleCode): roleCode is string => Boolean(roleCode));
    rolePermissions = permissions || [];
  }

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return {
      user,
      roleCodes,
      permissions: [{ module_code: "*", action_code: "*", allowed: true }],
    } satisfies ServerPermissionContext;
  }

  const permissionMap = new Map<string, ServerPermission>();

  [...rolePermissions, ...((userPermissions || []) as ServerPermission[])].forEach(
    (permission) => {
      permissionMap.set(
        `${permission.module_code}:${permission.action_code}`,
        permission
      );
    }
  );

  return {
    user,
    roleCodes,
    permissions: Array.from(permissionMap.values()),
  } satisfies ServerPermissionContext;
}

export async function requirePermission(
  request: Request,
  moduleCode: string,
  actionCode: string
) {
  const context = await loadPermissionContext(request);

  if ("response" in context) return context;

  if (!hasPermission(context.permissions, moduleCode, actionCode)) {
    return failure(
      `You do not have permission to ${actionCode} ${moduleCode}.`,
      403
    );
  }

  return context;
}

export async function requireAnyPermission(
  request: Request,
  checks: Array<{ moduleCode: string; actionCode: string }>
) {
  const context = await loadPermissionContext(request);

  if ("response" in context) return context;

  const allowed = checks.some((check) =>
    hasPermission(context.permissions, check.moduleCode, check.actionCode)
  );

  if (!allowed) {
    return failure("You do not have permission to perform this action.", 403);
  }

  return context;
}
