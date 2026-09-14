export const SITEQUBE_ROOT_DOMAIN = "siteqube.com";
export const RESERVED_TENANT_SLUGS = new Set([
  "www", "app", "api", "admin", "owner", "platform", "dashboard", "auth", "login", "signup",
  "support", "help", "docs", "status", "billing", "payments", "mail", "email", "smtp", "ftp",
  "cdn", "assets", "static",
]);
export function normalizeTenantSlug(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
export function tenantHostname(value: unknown) { const slug = normalizeTenantSlug(value); return slug ? slug + "." + SITEQUBE_ROOT_DOMAIN : ""; }
export function tenantSlugError(value: unknown) {
  const slug = normalizeTenantSlug(value);
  if (!slug) return "invalid" as const;
  if (slug.length < 3 || slug.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return "invalid" as const;
  if (RESERVED_TENANT_SLUGS.has(slug)) return "reserved" as const;
  return null;
}
export function isValidTenantSlug(value: unknown) { return tenantSlugError(value) === null; }
