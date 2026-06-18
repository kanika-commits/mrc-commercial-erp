import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = adminClient();

    const [
      profile,
      roles,
      organizations,
      companies,
      sites,
      modules,
      userRoles,
      accessRows,
      userPermissions,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("roles")
        .select("id, role_name, role_code, status")
        .eq("status", "active")
        .order("role_name"),
      supabase
        .from("organizations")
        .select("id, name, code, status")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("companies")
        .select("id, organization_id, company_name, company_code, status")
        .eq("status", "active")
        .order("company_name"),
      supabase
        .from("sites")
        .select("id, company_id, site_name, site_code, status")
        .eq("status", "active")
        .order("site_name"),
      supabase
        .from("erp_modules")
        .select("id, module_group, module_code, module_name, sort_order")
        .or("status.eq.active,module_code.eq.dashboard"),
      supabase.from("user_roles").select("role_id").eq("user_id", id),
      supabase
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", id),
      supabase
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", id),
    ]);

    for (const result of [
      profile,
      roles,
      organizations,
      companies,
      sites,
      modules,
      userRoles,
      accessRows,
      userPermissions,
    ]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      profile: profile.data,
      roles: roles.data || [],
      organizations: organizations.data || [],
      companies: sortCompanies(companies.data || []),
      sites: sites.data || [],
      modules: modules.data || [],
      userRoles: userRoles.data || [],
      accessRows: accessRows.data || [],
      userPermissions: userPermissions.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load user access." },
      { status: 500 }
    );
  }
}

function uniqueRows<T>(rows: T[], keyFor: (row: T) => string) {
  return Array.from(new Map(rows.map((row) => [keyFor(row), row])).values());
}

type RoleRow = {
  user_id: string;
  role_id: string;
};

type AccessRow = {
  user_id: string;
  organization_id: string | null;
  company_id: string | null;
  site_id: string | null;
};

type PermissionRow = {
  user_id: string;
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      role_ids,
      organization_ids,
      company_ids,
      site_ids,
      user_permissions,
    } = body;

    if (!Array.isArray(role_ids) || role_ids.length === 0) {
      return NextResponse.json(
        { error: "Select at least one role." },
        { status: 400 }
      );
    }

    if (!Array.isArray(organization_ids) || organization_ids.length === 0) {
      return NextResponse.json(
        { error: "Select at least one organization." },
        { status: 400 }
      );
    }

    const supabase = adminClient();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return NextResponse.json(
        { error: "User profile was not found." },
        { status: 404 }
      );
    }

    const { data: selectedSites, error: siteError } = site_ids?.length
      ? await supabase
          .from("sites")
          .select("id, company_id")
          .in("id", site_ids)
      : { data: [], error: null };

    if (siteError) throw siteError;

    const companyIds = Array.from(
      new Set([
        ...(company_ids || []),
        ...(selectedSites || []).map((site) => site.company_id).filter(Boolean),
      ])
    );

    const { data: selectedCompanies, error: companyError } = companyIds.length
      ? await supabase
          .from("companies")
          .select("id, organization_id")
          .in("id", companyIds)
      : { data: [], error: null };

    if (companyError) throw companyError;

    const companyById = new Map(
      (selectedCompanies || []).map((company) => [company.id, company])
    );
    const siteById = new Map((selectedSites || []).map((site) => [site.id, site]));

    const roleRows = uniqueRows<RoleRow>(
      role_ids.map((roleId: string) => ({
        user_id: id,
        role_id: roleId,
      })),
      (row) => `${row.user_id}.${row.role_id}`
    );

    const accessRows = uniqueRows<AccessRow>(
      [
        ...organization_ids.map((organizationId: string) => ({
          user_id: id,
          organization_id: organizationId,
          company_id: null,
          site_id: null,
        })),
        ...(company_ids || []).map((companyId: string) => {
          const company = companyById.get(companyId);

          return {
            user_id: id,
            organization_id: company?.organization_id || null,
            company_id: companyId,
            site_id: null,
          };
        }),
        ...(site_ids || []).map((siteId: string) => {
          const site = siteById.get(siteId);
          const company = site?.company_id ? companyById.get(site.company_id) : null;

          return {
            user_id: id,
            organization_id: company?.organization_id || organization_ids[0] || null,
            company_id: site?.company_id || null,
            site_id: siteId,
          };
        }),
      ],
      (row) => `${row.user_id}.${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
    );

    const permissionRows = uniqueRows<PermissionRow>(
      (user_permissions || [])
        .filter((permission: any) => permission.allowed === true)
        .map((permission: any) => ({
          user_id: id,
          module_code: permission.module_code,
          action_code: permission.action_code,
          allowed: true,
        })),
      (row) => `${row.user_id}.${row.module_code}.${row.action_code}`
    );

    const { error: deleteRolesError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", id);

    if (deleteRolesError) throw deleteRolesError;

    const { error: insertRolesError } = await supabase
      .from("user_roles")
      .insert(roleRows);

    if (insertRolesError) throw insertRolesError;

    const { error: deleteAccessError } = await supabase
      .from("user_access_assignments")
      .delete()
      .eq("user_id", id);

    if (deleteAccessError) throw deleteAccessError;

    if (accessRows.length > 0) {
      const { error: insertAccessError } = await supabase
        .from("user_access_assignments")
        .insert(accessRows);

      if (insertAccessError) throw insertAccessError;
    }

    const { error: deletePermissionsError } = await supabase
      .from("user_permissions")
      .delete()
      .eq("user_id", id);

    if (deletePermissionsError) throw deletePermissionsError;

    if (permissionRows.length > 0) {
      const { error: insertPermissionsError } = await supabase
        .from("user_permissions")
        .insert(permissionRows);

      if (insertPermissionsError) throw insertPermissionsError;
    }

    return NextResponse.json({
      user_id: id,
      roles_saved: roleRows.length,
      access_saved: accessRows.length,
      permissions_saved: permissionRows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save user access." },
      { status: 500 }
    );
  }
}
