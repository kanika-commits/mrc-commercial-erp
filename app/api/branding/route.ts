import { NextResponse } from "next/server";
import { createBrandingAdmin, resolveCurrentOrganization, TENANT_BRANDING_BUCKET } from "@/lib/serverTenantBranding";
import { defaultTenantBranding, resolveTenantBranding } from "@/lib/tenantBranding";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";

export async function GET() {
  try {
    const admin = createBrandingAdmin();
    const organization = await resolveCurrentOrganization(admin);
    const { data, error } = await admin.from("organization_branding").select("organization_name, logo_path, primary_color, secondary_color, login_tagline").eq("organization_id", organization.id).maybeSingle();
    if (error && error.code !== "42P01") throw error;
    const branding = resolveTenantBranding(data ? { organizationName: data.organization_name, logoPath: data.logo_path, primaryColor: data.primary_color, secondaryColor: data.secondary_color, loginTagline: data.login_tagline } : { organizationName: organization.name });
    if (branding.logoPath) branding.logoUrl = await createPrivateStorageAdapter(admin).createSignedReadUrl({ bucket: TENANT_BRANDING_BUCKET, key: branding.logoPath });
    return NextResponse.json(branding);
  } catch {
    return NextResponse.json(resolveTenantBranding(defaultTenantBranding));
  }
}
