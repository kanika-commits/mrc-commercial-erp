import { createClient } from "@supabase/supabase-js";

export const TENANT_BRANDING_BUCKET = "tenant-branding-assets";

export function createBrandingAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function resolveOrganizationForBranding(admin: any, hostname: string | null | undefined, options: { allowLocalDevelopmentFallback?: boolean } = {}) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (normalized) {
    const domainResult = await admin.from("organization_domains")
      .select("organization_id")
      .eq("hostname", normalized)
      .eq("status", "active")
      .maybeSingle();
    if (domainResult.error && domainResult.error.code !== "42P01") throw domainResult.error;
    if (domainResult.data?.organization_id) {
      const organizationResult = await admin.from("organizations").select("id, name, status").eq("id", domainResult.data.organization_id).eq("status", "active").maybeSingle();
      if (organizationResult.error) throw organizationResult.error;
      return organizationResult.data || null;
    }
  }
  if (options.allowLocalDevelopmentFallback && process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(normalized)) {
    const { data, error } = await admin.from("organizations").select("id, name, status").eq("status", "active").limit(2);
    if (error) throw error;
    if (data?.length === 1) return data[0];
  }
  return null;
}
