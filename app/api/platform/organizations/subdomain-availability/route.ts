import { NextResponse } from "next/server";
import { platformAdminClient, requirePlatformOwner } from "@/lib/serverPlatform";
import { normalizeTenantSlug, tenantHostname, tenantSlugError } from "@/lib/platformTenantSlug";
export async function GET(request: Request) {
  const access = await requirePlatformOwner(request);
  if ("response" in access) return access.response;
  const slug = normalizeTenantSlug(new URL(request.url).searchParams.get("slug"));
  const reason = tenantSlugError(slug);
  if (reason) return NextResponse.json({ slug, hostname: tenantHostname(slug), available: false, reason });
  const admin = platformAdminClient();
  const [slugResult, hostnameResult] = await Promise.all([admin.from("organization_domains").select("id", { count: "exact", head: true }).eq("slug", slug), admin.from("organization_domains").select("id", { count: "exact", head: true }).eq("hostname", tenantHostname(slug))]);
  if (slugResult.error || hostnameResult.error) return NextResponse.json({ error: "Unable to check SiteQube URL availability." }, { status: 500 });
  const available = !slugResult.count && !hostnameResult.count;
  return NextResponse.json({ slug, hostname: tenantHostname(slug), available, reason: available ? null : "already_taken" });
}
