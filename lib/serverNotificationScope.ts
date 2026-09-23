import { createClient } from "@supabase/supabase-js";
import { loadPermissionContext } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { createBrandingAdmin, resolveOrganizationForBranding } from "@/lib/serverTenantBranding";
import { trustedHostFromRequest } from "@/lib/managedTenant/trustedHost";
import { resolveTenantHostname } from "@/lib/tenantHostnameResolver";

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function loadNotificationRequestScope(request: Request) {
  const auth = await loadPermissionContext(request);
  if ("response" in auth) return { response: auth.response } as const;

  const admin = serviceClient();
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  const requestedOrganizationId = new URL(request.url).searchParams.get("organization_id")?.trim() || null;
  const hostname = trustedHostFromRequest(request);
  const tenantResolution = await resolveTenantHostname(admin, hostname);
  let hostOrganizationId: string | null = tenantResolution.type === "tenant"
    ? String(tenantResolution.organization?.id || "") || null
    : null;

  if (!hostOrganizationId && (tenantResolution.type === "local" || tenantResolution.type === "legacy")) {
    const organization = await resolveOrganizationForBranding(admin, hostname, { allowLocalDevelopmentFallback: true });
    hostOrganizationId = organization?.id || null;
  }

  if (hostOrganizationId && requestedOrganizationId && hostOrganizationId !== requestedOrganizationId) {
    return { error: "Selected organization does not match the active tenant.", status: 403 } as const;
  }

  let organizationId = hostOrganizationId || requestedOrganizationId;
  if (!organizationId && organizationScope !== null && organizationScope.length === 1) {
    organizationId = organizationScope[0];
  }
  if (!organizationId) {
    return { error: "An active organization is required.", status: 400 } as const;
  }
  if (!isInOrganizationScope(organizationScope, organizationId)) {
    return { error: "Selected organization is outside your access scope.", status: 403 } as const;
  }

  const { data: organization, error } = await admin.from("organizations")
    .select("id")
    .eq("id", organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!organization) return { error: "Active organization not found.", status: 404 } as const;

  return { auth, admin, organizationId } as const;
}
