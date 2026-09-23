import { normalizeTenantSlug, RESERVED_TENANT_SLUGS, SITEQUBE_ROOT_DOMAIN } from "@/lib/platformTenantSlug";
import { normalizeTrustedHost } from "@/lib/managedTenant/trustedHost";

export type TenantHostResolution =
  | { type: "tenant"; hostname: string; slug: string; domain: any; organization: any }
  | { type: "legacy" | "local" | "root" | "platform" | "unknown"; hostname: string };

function hostFromInput(value: string | null | undefined) {
  return normalizeTrustedHost(value) || String(value || "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function classifyTenantHostname(value: string | null | undefined) {
  const hostname = hostFromInput(value);
  if (!hostname) return { type: "unknown" as const, hostname: "" };
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return { type: "local" as const, hostname };
  if (hostname === "iq.consolpro.co.in") return { type: "legacy" as const, hostname };
  if (hostname === SITEQUBE_ROOT_DOMAIN || hostname === `www.${SITEQUBE_ROOT_DOMAIN}`) return { type: "root" as const, hostname };
  if (hostname === `platform.${SITEQUBE_ROOT_DOMAIN}`) return { type: "platform" as const, hostname };
  if (!hostname.endsWith(`.${SITEQUBE_ROOT_DOMAIN}`)) return { type: "unknown" as const, hostname };
  const slug = hostname.slice(0, -`.${SITEQUBE_ROOT_DOMAIN}`.length);
  if (!slug || slug.includes(".") || RESERVED_TENANT_SLUGS.has(slug) || normalizeTenantSlug(slug) !== slug) {
    return { type: "unknown" as const, hostname };
  }
  return { type: "tenant" as const, hostname, slug };
}

export async function resolveTenantHostname(admin: { from: (table: string) => any }, value: string | null | undefined): Promise<TenantHostResolution> {
  const classified = classifyTenantHostname(value);
  if (classified.type === "local" && process.env.NODE_ENV !== "production") {
    const configuredCode = String(process.env.SITEQUBE_DEV_TENANT_CODE || "").trim();
    if (!configuredCode) return { type: "unknown", hostname: classified.hostname };
    const organizationResult = await admin.from("organizations")
      .select("id, name, status, code")
      .eq("code", configuredCode)
      .eq("status", "active")
      .maybeSingle();
    if (organizationResult.error) throw organizationResult.error;
    if (!organizationResult.data) return { type: "unknown", hostname: classified.hostname };
    return {
      type: "tenant",
      hostname: classified.hostname,
      slug: configuredCode.toLowerCase(),
      domain: null,
      organization: organizationResult.data,
    };
  }
  if (classified.type !== "tenant") return classified;
  const domainResult = await admin.from("organization_domains")
    .select("id, organization_id, hostname, slug, status")
    .eq("hostname", classified.hostname)
    .eq("status", "active")
    .maybeSingle();
  if (domainResult.error && domainResult.error.code !== "42P01") throw domainResult.error;
  if (!domainResult.data?.organization_id) return { type: "unknown", hostname: classified.hostname };
  const organizationResult = await admin.from("organizations")
    .select("id, name, status")
    .eq("id", domainResult.data.organization_id)
    .eq("status", "active")
    .maybeSingle();
  if (organizationResult.error) throw organizationResult.error;
  if (!organizationResult.data) return { type: "unknown", hostname: classified.hostname };
  return { type: "tenant", hostname: classified.hostname, slug: classified.slug, domain: domainResult.data, organization: organizationResult.data };
}
