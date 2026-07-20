import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";
import { requirePermission } from "@/lib/serverPermissions";
import {
  loadActorOrganizationScope,
  loadVisibleUserIds,
} from "@/lib/adminUserScope";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: Request) {
  try {
    const permission = await requirePermission(request, "users", "view");

    if ("response" in permission) {
      return permission.response;
    }

    const supabase = adminClient();
    const actorOrganizationIds = await loadActorOrganizationScope(
      supabase,
      permission
    );
    const visibleUserIds = await loadVisibleUserIds(supabase, actorOrganizationIds);

    if (visibleUserIds?.length === 0) {
      return NextResponse.json({
        profiles: [],
        roles: [],
        userRoles: [],
        accessRows: [],
        organizations: [],
        companies: [],
        sites: [],
      });
    }

    const profilesQuery = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    const userRolesQuery = supabase.from("user_roles").select("id, user_id, role_id");
    const accessRowsQuery = supabase
      .from("user_access_assignments")
      .select("user_id, organization_id, company_id, site_id");
    const organizationsQuery = supabase.from("organizations").select("id, name, code");
    const companiesQuery = supabase
      .from("companies")
      .select("id, organization_id, company_name, company_code");
    const sitesQuery = supabase
      .from("sites")
      .select("id, organization_id, site_name, site_code");

    const scopedProfilesQuery = visibleUserIds
      ? profilesQuery.in("id", visibleUserIds)
      : profilesQuery;
    const scopedUserRolesQuery = visibleUserIds
      ? userRolesQuery.in("user_id", visibleUserIds)
      : userRolesQuery;
    const scopedAccessRowsQuery = visibleUserIds
      ? accessRowsQuery.in("user_id", visibleUserIds)
      : accessRowsQuery;
    const scopedOrganizationsQuery = actorOrganizationIds
      ? organizationsQuery.in("id", actorOrganizationIds)
      : organizationsQuery;
    const scopedCompaniesQuery = actorOrganizationIds
      ? companiesQuery.in("organization_id", actorOrganizationIds)
      : companiesQuery;
    const scopedSitesQuery = actorOrganizationIds
      ? sitesQuery.in("organization_id", actorOrganizationIds)
      : sitesQuery;

    const [
      profiles,
      roles,
      userRoles,
      accessRows,
      organizations,
      companies,
      sites,
    ] = await Promise.all([
      scopedProfilesQuery,
      supabase
        .from("roles")
        .select("id, role_name, role_code, status, is_system_role, created_at")
        .order("role_name"),
      scopedUserRolesQuery,
      scopedAccessRowsQuery,
      scopedOrganizationsQuery,
      scopedCompaniesQuery,
      scopedSitesQuery,
    ]);

    for (const result of [
      profiles,
      roles,
      userRoles,
      accessRows,
      organizations,
      companies,
      sites,
    ]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      profiles: profiles.data || [],
      roles: roles.data || [],
      userRoles: userRoles.data || [],
      accessRows: accessRows.data || [],
      organizations: organizations.data || [],
      companies: sortCompanies(companies.data || []),
      sites: sites.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load admin users." },
      { status: 500 }
    );
  }
}
