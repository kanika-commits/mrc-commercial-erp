import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";

export async function GET(request: Request) {
  try {
    const access = await requirePlatformOwner(request);
    if ("response" in access) return access.response;
    const admin = platformAdminClient();
    const [orgs, memberships, modules, domains] = await Promise.all([
      admin.from("organizations").select("id, name, code, status, created_at").order("created_at", { ascending: false }),
      admin.from("organization_memberships").select("id", { count: "exact", head: true }),
      admin.from("organization_modules").select("id", { count: "exact", head: true }),
      admin.from("organization_domains").select("id", { count: "exact", head: true }),
    ]);
    if (orgs.error || memberships.error || modules.error || domains.error) throw orgs.error || memberships.error || modules.error || domains.error;
    const organizationIds = (orgs.data || []).map((row) => row.id);
    const [moduleRows, domainRows] = organizationIds.length ? await Promise.all([
      admin.from("organization_modules").select("organization_id, module_code, enabled").in("organization_id", organizationIds),
      admin.from("organization_domains").select("organization_id, hostname, slug, status, is_primary").in("organization_id", organizationIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (moduleRows.error || domainRows.error) throw moduleRows.error || domainRows.error;
    return NextResponse.json({ metrics: { organizations: orgs.data?.length || 0, platformUsers: memberships.count || 0, managedEntitlements: modules.count || 0, configuredDomains: domains.count || 0 }, organizations: (orgs.data || []).map((org) => ({ ...org, entitlementMode: (moduleRows.data || []).some((row) => row.organization_id === org.id) ? "Managed" : "Legacy / Existing Access", domainStatus: (domainRows.data || []).some((row) => row.organization_id === org.id) ? "Configured" : "Not configured" })) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load platform overview." }, { status: 500 });
  }
}
