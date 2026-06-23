type ServiceClient = any;

type PermissionContext = {
  user: { id: string };
  roleCodes: string[];
};

export function isPlatformOwnerContext(context: PermissionContext) {
  return context.roleCodes.includes("platform_owner");
}

export async function loadActorOrganizationScope(
  admin: ServiceClient,
  context: PermissionContext
): Promise<string[] | null> {
  if (isPlatformOwnerContext(context)) {
    return null;
  }

  const { data, error } = await admin
    .from("user_access_assignments")
    .select("organization_id")
    .eq("user_id", context.user.id);

  if (error) throw error;

  return Array.from(
    new Set(
      (data || [])
        .map((row: any) => row.organization_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    )
  );
}

export async function loadVisibleUserIds(
  admin: ServiceClient,
  actorOrganizationIds: string[] | null
): Promise<string[] | null> {
  if (actorOrganizationIds === null) return null;
  if (actorOrganizationIds.length === 0) return [];

  const { data, error } = await admin
    .from("user_access_assignments")
    .select("user_id")
    .in("organization_id", actorOrganizationIds);

  if (error) throw error;

  return Array.from(
    new Set(
      (data || [])
        .map((row: any) => row.user_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    )
  );
}

export async function canAccessTargetUser(
  admin: ServiceClient,
  actorOrganizationIds: string[] | null,
  targetUserId: string
) {
  if (actorOrganizationIds === null) return true;
  if (actorOrganizationIds.length === 0) return false;

  const { data, error } = await admin
    .from("user_access_assignments")
    .select("user_id")
    .eq("user_id", targetUserId)
    .in("organization_id", actorOrganizationIds)
    .limit(1);

  if (error) throw error;

  return (data || []).length > 0;
}

export async function validateSubmittedUserScope(
  admin: ServiceClient,
  actorOrganizationIds: string[] | null,
  input: {
    organizationIds: string[];
    companyIds: string[];
    siteIds: string[];
  }
) {
  if (actorOrganizationIds === null) return { allowed: true } as const;

  const actorOrgSet = new Set(actorOrganizationIds);
  const organizationIds = input.organizationIds.filter(Boolean);
  const companyIds = input.companyIds.filter(Boolean);
  const siteIds = input.siteIds.filter(Boolean);

  if (organizationIds.some((organizationId) => !actorOrgSet.has(organizationId))) {
    return {
      allowed: false,
      error: "You cannot assign users outside your organization.",
    } as const;
  }

  if (companyIds.length > 0) {
    const { data: companies, error } = await admin
      .from("companies")
      .select("id, organization_id")
      .in("id", companyIds);

    if (error) throw error;

    const companyOrgById = new Map<string, string>(
      (companies || [])
        .filter(
          (company: any) =>
            typeof company.id === "string" &&
            typeof company.organization_id === "string"
        )
        .map((company: any) => [company.id, company.organization_id])
    );

    const invalidCompany = companyIds.some((companyId) => {
      const organizationId = companyOrgById.get(companyId);
      return !organizationId || !actorOrgSet.has(organizationId);
    });

    if (invalidCompany) {
      return {
        allowed: false,
        error: "You cannot assign company access outside your organization.",
      } as const;
    }
  }

  if (siteIds.length > 0) {
    const { data: sites, error } = await admin
      .from("sites")
      .select("id, organization_id")
      .in("id", siteIds);

    if (error) throw error;

    const siteOrgById = new Map<string, string>(
      (sites || [])
        .filter(
          (site: any) =>
            typeof site.id === "string" &&
            typeof site.organization_id === "string"
        )
        .map((site: any) => [site.id, site.organization_id])
    );

    const invalidSite = siteIds.some((siteId) => {
      const organizationId = siteOrgById.get(siteId);
      return !organizationId || !actorOrgSet.has(organizationId);
    });

    if (invalidSite) {
      return {
        allowed: false,
        error: "You cannot assign site access outside your organization.",
      } as const;
    }
  }

  return { allowed: true } as const;
}
