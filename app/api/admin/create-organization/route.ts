import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const { data: organization, error: orgError } = await adminSupabase
      .from("organizations")
      .insert({
        name: organization_name,
        code: organization_code,
        status: "active",
      })
      .select("id")
      .single();

    if (orgError) throw orgError;

    const { data: company, error: companyError } = await adminSupabase
      .from("companies")
      .insert({
        organization_id: organization.id,
        company_name,
        company_code,
        status: "active",
      })
      .select("id")
      .single();

    if (companyError) throw companyError;

    const { data: authData, error: authError } =
      await adminSupabase.auth.admin.createUser({
        email: admin_email,
        password: admin_password,
        email_confirm: true,
        user_metadata: {
          full_name: admin_name,
        },
      });

    if (authError) throw authError;

    const user = authData.user;

    if (!user) {
      throw new Error("Super Admin user was not created.");
    }

    const { error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: admin_email,
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

    const { error: userRoleError } = await adminSupabase
      .from("user_roles")
      .insert({
        user_id: user.id,
        role_id: superAdminRole.id,
      });

    if (userRoleError) throw userRoleError;

    const { error: accessError } = await adminSupabase
      .from("user_access_assignments")
      .insert([
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
      ]);

    if (accessError) throw accessError;

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