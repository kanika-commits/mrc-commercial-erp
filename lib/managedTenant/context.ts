import type { ServerPermissionContext } from "@/lib/serverPermissions";
import { resolveManagedTenantScope } from "@/lib/managedTenant/scope";
import { classifyTenantHostname, resolveTenantHostname } from "@/lib/tenantHostnameResolver";

type ManagedTenantAdmin = { from: (table: string) => any };

export type ManagedTenantContext = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  membershipId: string;
  membershipStatus: string;
  membershipType: string | null;
  domainSlug: string | null;
  hostname: string;
  enabledModules: string[];
  entitlementMode: "managed";
  companies: Array<{ id: string; name: string | null }>;
  sites: Array<{ id: string; name: string | null }>;
  permissions: ServerPermissionContext["permissions"];
  roles: string[];
  managedRoleId: string;
  managedRoleCode: string;
  managedRoleName: string;
  managedRoleTemplateCode: string;
  isPlatformOwner: boolean;
};

export function normalizeManagedTenantHostname(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/, 1)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

async function findActiveDomain(admin: ManagedTenantAdmin, hostname: string) {
  const byHostname = await admin
    .from("organization_domains")
    .select("id, organization_id, hostname, slug, status")
    .eq("hostname", hostname)
    .eq("status", "active")
    .maybeSingle();
  if (byHostname.error && byHostname.error.code !== "42P01") throw byHostname.error;
  if (byHostname.data) return byHostname.data;

  const bySlug = await admin
    .from("organization_domains")
    .select("id, organization_id, hostname, slug, status")
    .eq("slug", hostname)
    .eq("status", "active")
    .maybeSingle();
  if (bySlug.error && bySlug.error.code !== "42P01") throw bySlug.error;
  return bySlug.data || null;
}

export async function resolveManagedTenantContext(
  admin: ManagedTenantAdmin,
  auth: ServerPermissionContext,
  input: { hostname: string },
): Promise<ManagedTenantContext | null> {
  const hostname = normalizeManagedTenantHostname(input.hostname);
  if (!hostname) return null;

  const classification = classifyTenantHostname(hostname);
  let domain;
  if (classification.type === "tenant") {
    const resolution = await resolveTenantHostname(admin, hostname);
    domain = resolution.type === "tenant" ? resolution.domain : null;
  } else {
    domain = await findActiveDomain(admin, hostname);
  }
  if (!domain?.organization_id) return null;

  const organizationResult = await admin
    .from("organizations")
    .select("id, name, status")
    .eq("id", domain.organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (organizationResult.error) throw organizationResult.error;
  if (!organizationResult.data) return null;

  const provisioningResult = await admin
    .from("platform_organization_provisioning")
    .select("status")
    .eq("organization_id", domain.organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (provisioningResult.error) throw provisioningResult.error;
  if (!provisioningResult.data) return null;

  const [modulesResult, membershipResult, managedRoleResult] = await Promise.all([
    admin.from("organization_modules").select("module_code").eq("organization_id", domain.organization_id).eq("enabled", true).order("module_code"),
    admin.from("organization_memberships").select("id, membership_status, membership_type").eq("organization_id", domain.organization_id).eq("user_id", auth.user.id).eq("membership_status", "active").maybeSingle(),
    admin.from("managed_tenant_user_roles").select("role_id, managed_tenant_roles!inner(id, organization_id, role_code, role_name)").eq("organization_id", domain.organization_id).eq("user_id", auth.user.id),
  ]);
  if (modulesResult.error) throw modulesResult.error;
  if (membershipResult.error && membershipResult.error.code !== "42P01") throw membershipResult.error;
  if (managedRoleResult.error) throw managedRoleResult.error;
  if (!membershipResult.data || !modulesResult.data?.length || !managedRoleResult.data?.length) return null;

  const managedRoles = managedRoleResult.data
    .map((row: any) => row.managed_tenant_roles)
    .filter((role: any) => role?.organization_id === domain.organization_id && role?.role_code && role?.id);
  if (!managedRoles.length) return null;
  const roleIds = unique(managedRoles.map((role: any) => role.id));
  const permissionsResult = await admin
    .from("managed_tenant_role_permissions")
    .select("role_id, module_code, action_code, allowed")
    .in("role_id", roleIds)
    .eq("allowed", true);
  if (permissionsResult.error) throw permissionsResult.error;

  const enabledModules = unique((modulesResult.data || []).map((row: any) => row.module_code));
  const permissions = (permissionsResult.data || []).filter((permission: any) =>
    permission.module_code === "dashboard" ||
    permission.module_code === "administration" ||
    enabledModules.includes(permission.module_code),
  ).map((permission: any) => ({
    module_code: permission.module_code,
    action_code: permission.action_code,
    allowed: permission.allowed === true,
  }));
  if (!permissions.length) return null;

  const primaryRole = managedRoles[0];
  const isTenantAdministrator = managedRoles.some((role: any) => role.role_code === "tenant_administrator");

  const [companiesResult, sitesResult, scopesResult] = await Promise.all([
    admin.from("companies").select("id, company_name, status").eq("organization_id", domain.organization_id).eq("status", "active"),
    admin.from("sites").select("id, site_name, status").eq("organization_id", domain.organization_id).eq("status", "active"),
    isTenantAdministrator
      ? Promise.resolve({ data: [], error: null })
      : admin.from("managed_tenant_user_scopes").select("scope_type, company_id, site_id").eq("organization_id", domain.organization_id).in("managed_user_role_id", roleIds),
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (sitesResult.error) throw sitesResult.error;
  if (scopesResult.error) throw scopesResult.error;
  const scope = resolveManagedTenantScope(
    managedRoles.map((role: any) => role.role_code),
    domain.organization_id,
    (companiesResult.data || []).map((row: any) => ({ id: row.id, organization_id: domain.organization_id, name: row.company_name, status: row.status || "active" })),
    (sitesResult.data || []).map((row: any) => ({ id: row.id, organization_id: domain.organization_id, name: row.site_name, status: row.status || "active" })),
    (scopesResult.data || []).map((row: any) => ({
      id: row.scope_type === "company" ? row.company_id : row.site_id,
      organization_id: domain.organization_id,
      name: null,
      scope_type: row.scope_type,
    })),
  );

  return {
    userId: auth.user.id,
    organizationId: organizationResult.data.id,
    organizationName: organizationResult.data.name,
    organizationStatus: organizationResult.data.status,
    membershipId: membershipResult.data.id,
    membershipStatus: membershipResult.data.membership_status,
    membershipType: membershipResult.data.membership_type || null,
    domainSlug: domain.slug || null,
    hostname,
    enabledModules,
    entitlementMode: "managed",
    companies: scope.companies.map((row) => ({ id: row.id, name: row.name })),
    sites: scope.sites.map((row) => ({ id: row.id, name: row.name })),
    permissions,
    roles: managedRoles.map((role: any) => role.role_code),
    managedRoleId: primaryRole.id,
    managedRoleCode: primaryRole.role_code,
    managedRoleName: primaryRole.role_name,
    managedRoleTemplateCode: primaryRole.role_code,
    isPlatformOwner: auth.roleCodes.includes("platform_owner"),
  };
}

export function hasManagedTenantModule(context: ManagedTenantContext, moduleCode: string) {
  return context.enabledModules.includes(moduleCode);
}

export function hasManagedTenantPermission(context: ManagedTenantContext, moduleCode: string, actionCode: string) {
  return context.permissions.some((permission) =>
    permission.allowed === true &&
    ((permission.module_code === "*" && permission.action_code === "*") ||
      (permission.module_code === moduleCode && permission.action_code === actionCode)),
  );
}
