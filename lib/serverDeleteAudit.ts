import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

type ServiceClient = any;

type Permission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export type DeleteAuditInput = {
  organizationId?: string | null;
  moduleCode: string;
  documentType: string;
  documentId: string;
  documentNumber?: string | null;
  deletionReason: string;
  recordSnapshot?: unknown;
  relatedSnapshot?: unknown;
  fileSnapshot?: unknown;
};

export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function requireAuthenticatedUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 } as const;
  }

  return { user } as const;
}

function hasPermission(
  permissions: Permission[],
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

async function loadUserDeletePermissions(admin: ServiceClient, userId: string) {
  const [userRoles, userPermissions] = await Promise.all([
    admin.from("user_roles").select("role_id").eq("user_id", userId),
    admin
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", userId),
  ]);

  if (userRoles.error) throw userRoles.error;
  if (userPermissions.error) throw userPermissions.error;

  const roleIds = (userRoles.data || [])
    .map((row: { role_id: string | null }) => row.role_id)
    .filter(Boolean);

  let roleCodes: string[] = [];
  let rolePermissions: Permission[] = [];

  if (roleIds.length > 0) {
    const [roles, permissions] = await Promise.all([
      admin.from("roles").select("role_code").in("id", roleIds),
      admin
        .from("role_permissions")
        .select("module_code, action_code, allowed")
        .in("role_id", roleIds),
    ]);

    if (roles.error) throw roles.error;
    if (permissions.error) throw permissions.error;

    roleCodes = (roles.data || [])
      .map((role: { role_code: string | null }) => role.role_code)
      .filter(Boolean);
    rolePermissions = permissions.data || [];
  }

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return [{ module_code: "*", action_code: "*", allowed: true }];
  }

  const permissionMap = new Map<string, Permission>();

  [...rolePermissions, ...((userPermissions.data || []) as Permission[])].forEach(
    (permission) => {
      permissionMap.set(
        `${permission.module_code}:${permission.action_code}`,
        permission
      );
    }
  );

  return Array.from(permissionMap.values());
}

export async function requireDeletePermission(
  admin: ServiceClient,
  user: User,
  moduleCode: string
) {
  const permissions = await loadUserDeletePermissions(admin, user.id);

  if (!hasPermission(permissions, moduleCode, "delete")) {
    return {
      error: `You do not have delete permission for ${moduleCode}.`,
      status: 403,
    } as const;
  }

  return { allowed: true } as const;
}

export async function insertDeleteAudit(
  admin: ServiceClient,
  user: User,
  input: DeleteAuditInput
) {
  const userEmail = user.email || "";
  const userName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    userEmail ||
    "Unknown User";

  const { data, error } = await admin
    .from("deleted_records_audit")
    .insert({
      organization_id: input.organizationId || null,
      module_code: input.moduleCode,
      document_type: input.documentType,
      document_id: input.documentId,
      document_number: input.documentNumber || null,
      deleted_by_name: userName,
      deleted_by_email: userEmail,
      deletion_reason: input.deletionReason,
      record_snapshot: input.recordSnapshot || null,
      related_snapshot: input.relatedSnapshot || null,
      file_snapshot: input.fileSnapshot || null,
    })
    .select("id")
    .single();

  if (error) throw error;

  return data;
}
