export type TenantBranding = {
  organizationName: string;
  logoUrl?: string | null;
  logoPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  loginTagline?: string | null;
};

export const defaultTenantBranding: TenantBranding = {
  organizationName: "MRC Group",
  logoUrl: null,
  logoPath: null,
  primaryColor: "#1769aa",
  secondaryColor: "#0f3d56",
  loginTagline: "One platform for projects, people, procurement and operations.",
};

function safeColor(value: string | null | undefined, fallback: string) {
  const candidate = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

export function resolveTenantBranding(input: Partial<TenantBranding> = {}) {
  return {
    organizationName: String(input.organizationName || defaultTenantBranding.organizationName).trim() || defaultTenantBranding.organizationName,
    logoUrl: input.logoUrl || null,
    logoPath: input.logoPath || null,
    primaryColor: safeColor(input.primaryColor, defaultTenantBranding.primaryColor!),
    secondaryColor: safeColor(input.secondaryColor, defaultTenantBranding.secondaryColor!),
    loginTagline: String(input.loginTagline || defaultTenantBranding.loginTagline).trim() || defaultTenantBranding.loginTagline,
  };
}

export function isTenantBrandingColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}
