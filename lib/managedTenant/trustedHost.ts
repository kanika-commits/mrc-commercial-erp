import { RESERVED_TENANT_SLUGS as RESERVED_SLUGS, SITEQUBE_ROOT_DOMAIN } from "@/lib/platformTenantSlug";
const RESERVED_HOSTS = new Set([SITEQUBE_ROOT_DOMAIN, "www." + SITEQUBE_ROOT_DOMAIN, "platform." + SITEQUBE_ROOT_DOMAIN]);

function cleanHost(value: string | null | undefined) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || /[\u0000-\u001f\u007f,\s]/.test(raw) || raw.includes("://") || raw.includes("/") || raw.includes("?") || raw.includes("#")) return null;
  const withoutPort = raw.replace(/:\d+$/, "");
  if (withoutPort.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(withoutPort)) return null;
  if (withoutPort.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return withoutPort;
}

export function normalizeTrustedHost(value: string | null | undefined) {
  const host = cleanHost(value);
  if (!host || RESERVED_HOSTS.has(host)) return null;
  if (host.endsWith(".siteqube.com")) {
    const slug = host.slice(0, -".siteqube.com".length);
    if (!slug || slug.includes(".") || RESERVED_SLUGS.has(slug)) return null;
  }
  return host;
}

export function trustedHostFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-host");
  const source = process.env.TRUSTED_PROXY_HEADERS === "true" && forwarded ? forwarded : request.headers.get("host") || new URL(request.url).host;
  if (source.includes(",")) return null;
  return normalizeTrustedHost(source);
}

export { RESERVED_HOSTS, RESERVED_SLUGS };
