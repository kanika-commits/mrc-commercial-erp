import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requirePlatformOwner(request);
    if ("response" in access) return access.response;
    const { id } = await params;
    const admin = platformAdminClient();
    const [organization, modules, domains, memberships, companies, sites, invitations] = await Promise.all([
      admin.from("organizations").select("id, name, code, status, created_at").eq("id", id).maybeSingle(),
      admin.from("organization_modules").select("module_code, enabled").eq("organization_id", id),
      admin.from("organization_domains").select("hostname, slug, status, is_primary").eq("organization_id", id),
      admin.from("organization_memberships").select("id, user_id, membership_status, created_at").eq("organization_id", id),
      admin.from("companies").select("id", { count: "exact", head: true }).eq("organization_id", id),
      admin.from("sites").select("id", { count: "exact", head: true }).eq("organization_id", id),
      admin.from("managed_tenant_invitations").select("id, invited_email, invited_name, status, expires_at").eq("organization_id", id).order("created_at", { ascending: false }).limit(5),
    ]);
    if (organization.error) throw organization.error;
    if (!organization.data) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    if (modules.error || domains.error || memberships.error || companies.error || sites.error || invitations.error) throw modules.error || domains.error || memberships.error || companies.error || sites.error || invitations.error;
    return NextResponse.json({ organization: organization.data, entitlementMode: (modules.data || []).length ? "Managed" : "Legacy", modules: modules.data || [], domains: domains.data || [], memberships: memberships.data || [], invitations: invitations.data || [], businessSummary: { companies: companies.count || 0, sites: sites.count || 0 } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load organization." }, { status: 500 });
  }
}
