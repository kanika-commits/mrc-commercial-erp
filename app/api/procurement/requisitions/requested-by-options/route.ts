import { NextResponse } from "next/server";
import { adminClient, applyOrganizationAccess, jsonError, REQUISITION_MODULE, requireProcurementAny, text, validateCompanySiteAccess } from "@/lib/serverProcurementAccess";

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementAny(request, ["view", "add", "edit"].map((actionCode) => ({ moduleCode: REQUISITION_MODULE, actionCode })));
    if ("response" in auth) return auth.response;
    const { searchParams } = new URL(request.url);
    const companyId = text(searchParams.get("company_id"));
    const siteId = text(searchParams.get("site_id"));
    if (!companyId || !siteId) return jsonError("Company and site are required.", 400);
    const admin = adminClient();
    const scope = await validateCompanySiteAccess(admin, auth, companyId, siteId);
    if ("error" in scope) return jsonError(scope.error || "Selected company/site is invalid.", scope.status || 400);
    if (scope.site.status !== "active") return jsonError("Selected site is inactive.", 400);

    const { data: headOfficeSites, error: headOfficeSitesError } = await admin
      .from("sites")
      .select("id, site_name, site_code")
      .eq("organization_id", scope.organizationId)
      .eq("site_code", "HO")
      .eq("status", "active");
    if (headOfficeSitesError) throw headOfficeSitesError;
    const eligibleSiteIds = [siteId, ...(headOfficeSites || []).map((site: any) => site.id)].filter(Boolean) as string[];
    const queries = eligibleSiteIds.map((eligibleSiteId) => applyOrganizationAccess(
      admin.from("hr_employees")
        .select("id, employee_code, employee_name, site_id, site:sites(id, site_name, site_code), designation:hr_designations(designation_name)")
        .eq("organization_id", scope.organizationId)
        .eq("site_id", eligibleSiteId)
        .eq("status", "active")
        .order("employee_name"),
      auth,
    ));
    if (queries.some((query) => !query)) return NextResponse.json({ employees: [] });
    const results = await Promise.all(queries.map((query) => query!));
    const employees = Array.from(new Map(results.flatMap((result: any) => {
      if (result.error) throw result.error;
      return result.data || [];
    }).map((employee: any) => [employee.id, employee])).values()).sort((a: any, b: any) => String(a.employee_name || "").localeCompare(String(b.employee_name || "")));
    return NextResponse.json({ employees: employees.map((employee: any) => ({
      id: employee.id,
      employee_code: employee.employee_code,
      employee_name: employee.employee_name,
      designation_name: employee.designation?.designation_name || null,
      site_name: employee.site?.site_name || null,
      is_head_office: (headOfficeSites || []).some((site: any) => site.id === employee.site_id),
    })) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load Requested By employees." }, { status: 500 });
  }
}
