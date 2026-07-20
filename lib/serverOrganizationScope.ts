import type { ServerPermissionContext } from "@/lib/serverPermissions";

type ServiceClient = any;

export type OrganizationScope = string[] | null;

const MRC_ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";

function uniqueIds(rows: any[], key: string) {
  return Array.from(
    new Set(
      (rows || [])
        .map((row) => row?.[key])
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    )
  );
}

export function isGlobalScope(scope: OrganizationScope) {
  return scope === null;
}

export function isInOrganizationScope(
  scope: OrganizationScope,
  organizationId: string | null | undefined
) {
  if (scope === null) return true;
  if (!organizationId) return false;
  return scope.includes(organizationId);
}

export async function loadActorOrganizationScope(
  admin: ServiceClient,
  context: Pick<ServerPermissionContext, "user" | "roleCodes" | "permissions">
): Promise<OrganizationScope> {
  if (context.roleCodes.includes("platform_owner")) {
    return null;
  }

  return loadOrganizationScopeForUser(admin, context.user.id);
}

export async function loadOrganizationScopeForUser(
  admin: ServiceClient,
  userId: string
): Promise<OrganizationScope> {
  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  if (userRolesError) throw userRolesError;

  const roleIds = uniqueIds(userRoles || [], "role_id");

  if (roleIds.length > 0) {
    const { data: roles, error: rolesError } = await admin
      .from("roles")
      .select("role_code")
      .in("id", roleIds);

    if (rolesError) throw rolesError;

    const roleCodes = uniqueIds(roles || [], "role_code");
    if (roleCodes.includes("platform_owner")) {
      return null;
    }
  }

  const { data, error } = await admin
    .from("user_access_assignments")
    .select("organization_id")
    .eq("user_id", userId);

  if (error) throw error;

  return uniqueIds(data || [], "organization_id");
}

export function applyOrganizationScope<T extends { in: Function }>(
  query: T,
  scope: OrganizationScope,
  column = "organization_id"
) {
  if (scope === null) return query;
  if (scope.length === 0) return null;
  return query.in(column, scope);
}

export function resolveWriteOrganizationId(
  scope: OrganizationScope,
  requestedOrganizationId?: string | null
) {
  const requested = String(requestedOrganizationId || "").trim();

  if (scope === null) {
    return requested || MRC_ORGANIZATION_ID;
  }

  if (requested) {
    return scope.includes(requested) ? requested : null;
  }

  return scope.length === 1 ? scope[0] : null;
}
