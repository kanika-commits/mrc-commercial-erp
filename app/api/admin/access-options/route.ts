import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";
import { requireAnyPermission } from "@/lib/serverPermissions";

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

    const [roles, organizations, companies, sites] = await Promise.all([
      supabase
        .from("roles")
        .select("id, role_name, role_code")
        .eq("status", "active")
        .order("role_name"),
      supabase
        .from("organizations")
        .select("id, name, code")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("companies")
        .select("id, organization_id, company_name, company_code")
        .eq("status", "active")
        .order("company_name"),
      supabase
        .from("sites")
        .select("id, company_id, site_name, site_code")
        .eq("status", "active")
        .order("site_name"),
    ]);

    for (const result of [roles, organizations, companies, sites]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      roles: roles.data || [],
      organizations: organizations.data || [],
      companies: sortCompanies(companies.data || []),
      sites: sites.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load access options." },
      { status: 500 }
    );
  }
}
