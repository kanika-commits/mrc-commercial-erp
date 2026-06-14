import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function uniqueRows<T>(rows: T[], keyFor: (row: T) => string) {
  return Array.from(new Map(rows.map((row) => [keyFor(row), row])).values());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      organization_name,
      organization_code,
      company_name,
      company_code,
      admin_name,
      admin_email,
      admin_password,
    } = body;

    if (
      !organization_name ||
      !organization_code ||
      !company_name ||
      !company_code ||
      !admin_name ||
      !admin_email ||
      !admin_password
    ) {
      return NextResponse.json(
        { error: "All fields are required." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    const orgCode = String(organization_code).trim();
    const companyCode = String(company_code).trim();
    const adminEmail = normalizeEmail(admin_email);

    let { data: organization, error: orgLookupError } = await adminSupabase
      .from("organizations")
      .select("id")
      .eq("code", orgCode)
      .maybeSingle();

    if (orgLookupError) throw orgLookupError;

    if (!organization) {
      const { data, error } = await adminSupabase
        .from("organizations")
        .insert({
          name: organization_name,
          code: orgCode,
          status: "active",
        })
        .select("id")
        .single();

      if (error) throw error;
      organization = data;
    }

    let { data: company, error: companyLookupError } = await adminSupabase
      .from("companies")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("company_code", companyCode)
      .maybeSingle();

    if (companyLookupError) throw companyLookupError;

    if (!company) {
      const { data, error } = await adminSupabase
        .from("companies")
        .insert({
          organization_id: organization.id,
          company_name,
          company_code: companyCode,
          status: "active",
        })
        .select("id")
        .single();

      if (error) throw error;
      company = data;
    }

    const { data: existingUsers, error: listUsersError } =
      await adminSupabase.auth.admin.listUsers();

    if (listUsersError) throw listUsersError;

    let user = existingUsers.users.find(
      (item) => item.email?.toLowerCase() === adminEmail
    );

    if (!user) {
      const { data: authData, error: authError } =
        await adminSupabase.auth.admin.createUser({
          email: adminEmail,
          password: admin_password,
          email_confirm: true,
          user_metadata: {
            full_name: admin_name,
          },
        });

      if (authError) throw authError;
      user = authData.user || undefined;
    }

    if (!user) {
      throw new Error("Super Admin user was not created.");
    }

    const { error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: adminEmail,
        full_name: admin_name,
        status: "active",
      });

    if (profileError) throw profileError;

    const { data: superAdminRole, error: roleError } = await adminSupabase
      .from("roles")
      .select("id")
      .eq("role_code", "super_admin")
      .single();

    if (roleError) throw roleError;

    const { data: existingRoles, error: existingRoleError } = await adminSupabase
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role_id", superAdminRole.id);

    if (existingRoleError) throw existingRoleError;

    if ((existingRoles || []).length === 0) {
      const { error: userRoleError } = await adminSupabase
        .from("user_roles")
        .insert({
          user_id: user.id,
          role_id: superAdminRole.id,
        });

      if (userRoleError) throw userRoleError;
    }

    const accessRows = uniqueRows(
      [
        {
          user_id: user.id,
          organization_id: organization.id,
          company_id: null,
          site_id: null,
        },
        {
          user_id: user.id,
          organization_id: organization.id,
          company_id: company.id,
          site_id: null,
        },
      ],
      (row) => `${row.user_id}.${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
    );

    const { data: existingAccess, error: existingAccessError } =
      await adminSupabase
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", user.id);

    if (existingAccessError) throw existingAccessError;

    const existingAccessKeys = new Set(
      (existingAccess || []).map(
        (row) => `${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
      )
    );

    const newAccessRows = accessRows.filter(
      (row) =>
        !existingAccessKeys.has(
          `${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
        )
    );

    if (newAccessRows.length > 0) {
      const { error: accessError } = await adminSupabase
        .from("user_access_assignments")
        .insert(newAccessRows);

      if (accessError) throw accessError;
    }

    return NextResponse.json({
      organization_id: organization.id,
      company_id: company.id,
      user_id: user.id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create organization." },
      { status: 500 }
    );
  }
}
