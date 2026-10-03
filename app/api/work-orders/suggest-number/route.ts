import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient, hasGlobalProcurementAccess } from "@/lib/serverProcurementAccess";
import { isInOrganizationScope, loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";

const text = (value: unknown) => String(value ?? "").trim();

export async function GET(request: Request) {
  const auth = await requirePermission(request, "work_orders", "add");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const companyId = text(url.searchParams.get("company_id"));
  const siteId = text(url.searchParams.get("site_id"));
  if (!companyId || !siteId) return NextResponse.json({ error: "Company and site are required." }, { status: 400 });

  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  const activeOrganizationId = resolveWriteOrganizationId(scope);
  const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([
    admin.from("companies").select("id,organization_id,company_code,status").eq("id", companyId).maybeSingle(),
    admin.from("sites").select("id,organization_id,company_id,site_code,status").eq("id", siteId).maybeSingle(),
  ]);
  if (companyError) throw companyError;
  if (siteError) throw siteError;
  const access: any = auth;
  const globalAccess = hasGlobalProcurementAccess(auth);
  const companyAllowed = globalAccess || (access.companies || []).length === 0 || access.companies.includes(companyId);
  const siteAllowed = globalAccess || (access.sites || []).length === 0 || access.sites.includes(siteId);
  if (!company || !site || !activeOrganizationId || company.status !== "active" || site.status !== "active" || company.organization_id !== site.organization_id || company.organization_id !== activeOrganizationId || !isInOrganizationScope(scope, company.organization_id) || !companyAllowed || !siteAllowed) {
    return NextResponse.json({ error: "Selected company and site are not in the authorized scope." }, { status: 403 });
  }
  if (!company.company_code || !site.site_code) return NextResponse.json({ error: "Selected company and site must have codes." }, { status: 400 });

  const prefix = `${site.site_code}/${company.company_code}/`;
  const { data: rows, error } = await admin.from("work_orders").select("wo_number").eq("organization_id", company.organization_id).eq("company_id", company.id).eq("site_id", site.id).like("wo_number", `${prefix}%`);
  if (error) return NextResponse.json({ error: "Could not read existing Work Order numbers. Please try again." }, { status: 503 });
  const validNumbers = (rows || []).map((row) => Number(String(row.wo_number || "").split("/").pop())).filter((value) => Number.isInteger(value) && value >= 1);
  const next = validNumbers.length ? Math.max(...validNumbers) + 1 : 101;
  return NextResponse.json({ wo_number: `${prefix}${next}` });
}
