import type { User } from "@supabase/supabase-js";
import { loadActiveAccountContext, type ActiveAccountContext } from "@/lib/serverAccountAccess";

export type TenantMembershipDiagnostic = {
  status: string;
  type: string | null;
  roleIds: string[];
} | null;

export type TenantContext = {
  organizationId: string;
  organizationSlug: string | null;
  userId: string;
  membership: TenantMembershipDiagnostic;
  isPlatformOwner: boolean;
  enabledModules: string[];
  siteAccess: string[];
  companyAccess: string[];
};

type TenantContextClient = {
  from: (table: string) => any;
};

type ResolverOptions = {
  organizationId?: string | null;
};

function unique(values: Array<unknown>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

async function loadMembership(admin: TenantContextClient, userId: string, organizationId: string) {
  const result = await admin
    .from("organization_memberships")
    .select("membership_status, membership_type")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (result.error && result.error.code !== "42P01") throw result.error;
  if (!result.data) return null;

  const roles = await admin.from("user_roles").select("role_id").eq("user_id", userId);
  if (roles.error) throw roles.error;

  return {
    status: String(result.data.membership_status || "active"),
    type: result.data.membership_type || null,
    roleIds: unique((roles.data || []).map((row: { role_id?: string }) => row.role_id)),
  };
}

async function loadModules(admin: TenantContextClient, organizationId: string) {
  const result = await admin
    .from("organization_modules")
    .select("module_code")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .order("module_code");

  if (result.error && result.error.code !== "42P01") throw result.error;
  return unique((result.data || []).map((row: { module_code?: string }) => row.module_code));
}

async function resolveOrganizationId(admin: TenantContextClient, access: ActiveAccountContext, requested?: string | null) {
  const requestedId = String(requested || "").trim();
  if (requestedId && (access.isGlobalAccess || access.organizations.includes(requestedId))) return requestedId;
  if (access.organizations.length === 1) return access.organizations[0];
  if (access.isGlobalAccess) {
    const result = await admin.from("organizations").select("id").eq("status", "active").order("created_at").limit(1).maybeSingle();
    if (result.error) throw result.error;
    return result.data?.id || null;
  }
  return null;
}

export async function resolveTenantContext(
  admin: TenantContextClient,
  user: User,
  options: ResolverOptions = {},
): Promise<TenantContext | null> {
  const access = await loadActiveAccountContext(admin, user);
  if ("response" in access) return null;

  const organizationId = await resolveOrganizationId(admin, access, options.organizationId);
  if (!organizationId) return null;

  const organization = await admin
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (organization.error) throw organization.error;
  if (!organization.data) return null;

  const [membership, enabledModules, domain] = await Promise.all([
    loadMembership(admin, user.id, organizationId),
    loadModules(admin, organizationId),
    admin.from("organization_domains").select("slug").eq("organization_id", organizationId).eq("status", "active").eq("is_primary", true).maybeSingle(),
  ]);
  if (domain.error && domain.error.code !== "42P01") throw domain.error;

  return {
    organizationId,
    organizationSlug: domain.data?.slug || null,
    userId: user.id,
    membership,
    isPlatformOwner: access.isGlobalAccess,
    siteAccess: access.isGlobalAccess ? [] : access.sites,
    companyAccess: access.isGlobalAccess ? [] : access.companies,
    enabledModules,
  };
}
