export type ManagedScopeRow = {
  id: string;
  organization_id: string;
  name: string | null;
  status?: string | null;
};

export type ManagedAssignedScope = ManagedScopeRow & { scope_type: "company" | "site" };

export function resolveManagedTenantScope(
  roleCodes: string[],
  organizationId: string,
  companies: ManagedScopeRow[],
  sites: ManagedScopeRow[],
  assignedScopes: ManagedAssignedScope[] = [],
) {
  const tenantAdministrator = roleCodes.includes("tenant_administrator");
  if (!tenantAdministrator) {
    const companyIds = new Set(assignedScopes.filter((row) => row.scope_type === "company").map((row) => row.id));
    const siteIds = new Set(assignedScopes.filter((row) => row.scope_type === "site").map((row) => row.id));
    return {
      companies: companies.filter((row) => row.organization_id === organizationId && row.status === "active" && companyIds.has(row.id)),
      sites: sites.filter((row) => row.organization_id === organizationId && row.status === "active" && siteIds.has(row.id)),
    };
  }

  return {
    companies: companies.filter((row) => row.organization_id === organizationId && row.status === "active"),
    sites: sites.filter((row) => row.organization_id === organizationId && row.status === "active"),
  };
}
