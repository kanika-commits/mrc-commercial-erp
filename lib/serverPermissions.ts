import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { loadActiveAccountContext } from "@/lib/serverAccountAccess";

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

export async function loadPermissionContext(request: Request) {
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

  const accountContext = await loadActiveAccountContext(admin, user);

  if ("response" in accountContext) return accountContext;

  return accountContext satisfies ServerPermissionContext;
}

export function hasServerPermission(
  context: Pick<ServerPermissionContext, "permissions">,
  moduleCode: string,
  actionCode: string
) {
  return hasPermission(context.permissions, moduleCode, actionCode);
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
