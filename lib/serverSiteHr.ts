type SiteHrClient = { from: (table: string) => any };

export async function hasActiveSiteHrAssignment(admin: SiteHrClient, input: { userId: string; organizationId: string; companyId: string; siteId: string }) {
  const { data, error } = await admin.from("site_hr_assignments").select("id").eq("organization_id", input.organizationId).eq("company_id", input.companyId).eq("site_id", input.siteId).eq("user_id", input.userId).eq("status", "active").limit(1);
  if (!error) return Boolean(data?.length);
  if (error.code !== "42P01") throw error;
  const fallback = await admin.from("labour_site_configurations").select("id").eq("organization_id", input.organizationId).eq("company_id", input.companyId).eq("site_id", input.siteId).eq("site_hr_user_id", input.userId).eq("status", "active").limit(1);
  if (fallback.error) throw fallback.error;
  return Boolean(fallback.data?.length);
}

export async function loadActiveSiteHrUserIds(admin: SiteHrClient, input: { organizationId: string; companyId: string; siteId: string; fallbackUserId?: string | null }) {
  const { data, error } = await admin.from("site_hr_assignments").select("user_id").eq("organization_id", input.organizationId).eq("company_id", input.companyId).eq("site_id", input.siteId).eq("status", "active");
  if (!error) return Array.from(new Set((data || []).map((row: any) => row.user_id).filter(Boolean)));
  if (error.code !== "42P01") throw error;
  return input.fallbackUserId ? [input.fallbackUserId] : [];
}
