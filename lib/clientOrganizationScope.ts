import type { CurrentUserAccess } from "@/lib/accessControl";

export function hasGlobalOrganizationAccess(access: CurrentUserAccess | null | undefined) {
  if (!access) return false;
  return access.roleCodes.includes("platform_owner");
}

export function getAllowedOrganizationIds(access: CurrentUserAccess | null | undefined) {
  if (!access || hasGlobalOrganizationAccess(access)) return null;
  return access.organizations || [];
}

export function isOrganizationAllowed(
  access: CurrentUserAccess | null | undefined,
  organizationId: string | null | undefined
) {
  const allowedOrganizationIds = getAllowedOrganizationIds(access);
  if (allowedOrganizationIds === null) return true;
  if (!organizationId) return false;
  return allowedOrganizationIds.includes(organizationId);
}
