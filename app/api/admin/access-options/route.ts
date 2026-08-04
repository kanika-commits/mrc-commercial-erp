import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { loadActorOrganizationScope } from "@/lib/adminUserScope";
import { loadEmployeeLinkOptions } from "@/app/api/admin/users/_employeeLinking";

export async function GET(request: Request) {
  try {
    const permission = await requireAnyPermission(request, [
      { moduleCode: "users", actionCode: "add" },
      { moduleCode: "users", actionCode: "edit" },
    ]);

    if ("response" in permission) {
      return permission.response;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const actorOrganizationIds = await loadActorOrganizationScope(supabase, permission);

    const organizationsQuery = supabase
      .from("organizations")
      .select("id, name, code")
      .eq("status", "active")
      .order("name");
    const companiesQuery = supabase
      .from("companies")
      .select("id, organization_id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");
    const sitesQuery = supabase
      .from("sites")
      .select("id, company_id, site_name, site_code")
      .eq("status", "active")
      .order("site_name");

    const [roles, organizations, companies, sites, employeeOptions] = await Promise.all([
      supabase
        .from("roles")
        .select("id, role_name, role_code")
        .eq("status", "active")
        .order("role_name"),
      actorOrganizationIds ? organizationsQuery.in("id", actorOrganizationIds) : organizationsQuery,
      actorOrganizationIds ? companiesQuery.in("organization_id", actorOrganizationIds) : companiesQuery,
      actorOrganizationIds ? sitesQuery.in("organization_id", actorOrganizationIds) : sitesQuery,
      loadEmployeeLinkOptions(supabase, actorOrganizationIds),
    ]);

    for (const result of [roles, organizations, companies, sites]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      roles: (roles.data || []).filter((role) => role.role_code !== "platform_owner"),
      organizations: organizations.data || [],
      companies: sortCompanies(companies.data || []),
      sites: sites.data || [],
      employeeOptions,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load access options." },
      { status: 500 }
    );
  }
}
