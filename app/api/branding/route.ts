import { NextResponse } from "next/server";
import { createBrandingAdmin, resolveOrganizationForBranding, TENANT_BRANDING_BUCKET } from "@/lib/serverTenantBranding";
import { defaultTenantBranding, resolveTenantBranding } from "@/lib/tenantBranding";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";
import { trustedHostFromRequest } from "@/lib/managedTenant/trustedHost";
import { resolveTenantHostname } from "@/lib/tenantHostnameResolver";

export async function GET(request: Request) {
  try {
    const admin = createBrandingAdmin();
    const resolution = await resolveTenantHostname(admin, trustedHostFromRequest(request));
    const organization = resolution.type === "tenant"
      ? resolution.organization
      : resolution.type === "legacy" || resolution.type === "local"
        ? await resolveOrganizationForBranding(admin, resolution.hostname, { allowLocalDevelopmentFallback: true })
        : null;
    if (!organization) return NextResponse.json(resolveTenantBranding(defaultTenantBranding), { headers: { "Cache-Control": "no-store" } });
    const { data, error } = await admin.from("organization_branding").select("organization_name, logo_path, primary_color, secondary_color, login_tagline").eq("organization_id", organization.id).maybeSingle();
    if (error && error.code !== "42P01") throw error;
    const branding = resolveTenantBranding(data ? { organizationName: data.organization_name, logoPath: data.logo_path, primaryColor: data.primary_color, secondaryColor: data.secondary_color, loginTagline: data.login_tagline } : { organizationName: organization.name });
    if (branding.logoPath) branding.logoUrl = await createPrivateStorageAdapter(admin).createSignedReadUrl({ bucket: TENANT_BRANDING_BUCKET, key: branding.logoPath });
    return NextResponse.json(branding, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(resolveTenantBranding(defaultTenantBranding), { headers: { "Cache-Control": "no-store" } });
  }
}
