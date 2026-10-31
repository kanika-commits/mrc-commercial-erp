import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { ACCOUNT_INACTIVE_CODE } from "@/lib/accountStatus";

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
  isGlobalAccess?: boolean;
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

      if (response.ok) return response.json();

      const payload = await response.json().catch(() => null);

      if (payload?.code === ACCOUNT_INACTIVE_CODE) {
        await supabase.auth.signOut();
      }

      return {
        user: null,
        roleCodes: [],
        permissions: [],
        organizations: [],
        companies: [],
        sites: [],
      };
    }
  }

  // The server endpoint is the only source of authorization data.  Do not fall
  // back to browser-role table reads when it is unavailable: that path depends
  // on deployed RLS and can produce partial or cross-tenant access state.
  return {
    user: null,
    roleCodes: [],
    permissions: [],
    organizations: [],
    companies: [],
    sites: [],
    isGlobalAccess: false,
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
export function isSuperUser(access: CurrentUserAccess) {
  return hasGlobalAccess(access);
}

export function hasGlobalAccess(access: CurrentUserAccess | null | undefined) {
  if (!access) return false;

  return (
    access.isGlobalAccess === true ||
    access.roleCodes.includes("platform_owner") ||
    access.permissions.some(
      (permission) =>
        permission.allowed === true &&
        permission.module_code === "*" &&
        permission.action_code === "*"
    )
  );
}

export function isPlatformOwner(access: CurrentUserAccess) {
  return hasGlobalAccess(access);
}

export function isOrganizationAdmin(access: CurrentUserAccess) {
  return access.roleCodes.includes("super_admin");
}

export function hasSiteRestriction(access: CurrentUserAccess) {
  return !hasGlobalAccess(access) && access.sites.length > 0;
}
