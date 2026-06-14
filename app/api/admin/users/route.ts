import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET() {
  try {
    const supabase = adminClient();

    const [
      profiles,
      roles,
      userRoles,
      accessRows,
      organizations,
      companies,
      sites,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("roles")
        .select("id, role_name, role_code, status, is_system_role, created_at")
        .order("role_name"),
      supabase.from("user_roles").select("id, user_id, role_id"),
      supabase
        .from("user_access_assignments")
        .select("user_id, organization_id, company_id, site_id"),
      supabase.from("organizations").select("id, name, code"),
      supabase.from("companies").select("id, company_name, company_code"),
      supabase.from("sites").select("id, site_name, site_code"),
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
      companies: companies.data || [],
      sites: sites.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load admin users." },
      { status: 500 }
    );
  }
}
