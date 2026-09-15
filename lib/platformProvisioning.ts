import { tenantHostname, tenantSlugError, normalizeTenantSlug } from "@/lib/platformTenantSlug";
export const STANDARD_MODULES = ["dashboard", "hr", "labour", "purchase", "store", "commercial", "accounts", "reports", "administration"] as const;
export type StandardModule = (typeof STANDARD_MODULES)[number];
export type ManagedTenantProvisioningInput = {
  organization: { name: string; code?: string; industry?: string; country?: string; timezone?: string; contactName?: string; contactEmail?: string; contactPhone?: string };
  initialCompany: { name: string; code?: string };
  modules: string[];
  roleTemplateIds?: string[];
  domain: { slug: string };
  tenantAdmin: { name: string; email: string };
  primaryAdministrator?: { name: string; email: string };
  infrastructure: "standard" | "enterprise";
  branding?: { displayName: string; loginTagline: string; primaryColor: string; secondaryColor: string; logoPath?: string | null };
};
export function text(value: unknown) { return String(value || "").trim(); }
export function normalizeSlug(value: unknown) { return normalizeTenantSlug(value); }
export function normalizeEmail(value: unknown) { return text(value).toLowerCase(); }
export function normalizeModules(values: unknown) { return Array.from(new Set(Array.isArray(values) ? values.map(text).map((value) => value.toLowerCase()).filter(Boolean) : [])); }
export function validateManagedTenantInput(input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Partial<ManagedTenantProvisioningInput>;
  const organization = (body.organization || {}) as ManagedTenantProvisioningInput["organization"], initialCompany = (body.initialCompany || {}) as ManagedTenantProvisioningInput["initialCompany"], domain = (body.domain || {}) as ManagedTenantProvisioningInput["domain"], tenantAdmin = (body.primaryAdministrator || body.tenantAdmin || {}) as ManagedTenantProvisioningInput["tenantAdmin"];
  const modules = normalizeModules(body.modules), roleTemplateIds = Array.from(new Set(Array.isArray((body as any).roleTemplateIds) ? (body as any).roleTemplateIds.map(text).filter(Boolean) : [])), slug = normalizeSlug(domain.slug), errors: string[] = [];
  if (!text(organization.name)) errors.push("Organization name is required.");
  if (!text(organization.code)) errors.push("Organization code is required.");
  if (!text(initialCompany.name)) errors.push("Initial company name is required.");
  if (!text(initialCompany.code)) errors.push("Initial company code is required.");
  if (!text(tenantAdmin.name)) errors.push("Tenant administrator name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(tenantAdmin.email))) errors.push("A valid tenant administrator email is required.");
  if (body.infrastructure !== "standard") errors.push("Only Standard Tenant infrastructure is supported.");
  const slugError = tenantSlugError(slug);
  if (slugError === "invalid") errors.push("Tenant slug must use 3-63 lowercase letters, numbers, or hyphens.");
  if (slugError === "reserved") errors.push("That tenant slug is reserved.");
  if (!modules.includes("dashboard")) errors.push("Dashboard is a required core module.");
  if (!modules.includes("administration")) errors.push("Administration is a required core module.");
  if (modules.some((module) => !(STANDARD_MODULES as readonly string[]).includes(module))) errors.push("One or more selected modules are unsupported.");
  const administrator = { name: text(tenantAdmin.name), email: normalizeEmail(tenantAdmin.email), action: "invite_required" as const };
  const brandingInput = (body as any).branding || {};
  const branding = { displayName: text(brandingInput.displayName || organization.name), loginTagline: text(brandingInput.loginTagline), primaryColor: text(brandingInput.primaryColor), secondaryColor: text(brandingInput.secondaryColor), logoPath: null as string | null };
  if (!branding.displayName) errors.push("Branding display name is required.");
  if (branding.loginTagline.length > 160) errors.push("Branding tagline must be 160 characters or fewer.");
  if (!/^#[0-9a-f]{6}$/i.test(branding.primaryColor) || !/^#[0-9a-f]{6}$/i.test(branding.secondaryColor)) errors.push("Branding colors must be six-digit HEX values.");
  return { valid: errors.length === 0, errors, organization: { name: text(organization.name), code: text(organization.code) }, company: { name: text(initialCompany.name), code: text(initialCompany.code) }, modules, roleTemplateIds, domain: { slug, hostname: tenantHostname(slug) }, tenantAdmin: administrator, primaryAdministrator: administrator, branding, infrastructure: "standard" as const };
}
