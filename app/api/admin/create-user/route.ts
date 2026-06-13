import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      full_name,
      email,
      password,
      role_ids,
      organization_ids,
      company_ids,
      site_ids,
    } = body;

    if (!full_name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email and password are required." },
        { status: 400 }
      );
    }

    if (!role_ids?.length) {
      return NextResponse.json(
        { error: "Select at least one role." },
        { status: 400 }
      );
    }

    if (!organization_ids?.length) {
      return NextResponse.json(
        { error: "Select at least one organization." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } =
      await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
        },
      });

    if (authError) throw authError;

    const user = authData.user;

    if (!user) {
      throw new Error("User was not created.");
    }

    const { error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name,
        status: "active",
      });

    if (profileError) throw profileError;

    const roleRows = role_ids.map((roleId: string) => ({
      user_id: user.id,
      role_id: roleId,
    }));

    const { error: roleError } = await adminSupabase
      .from("user_roles")
      .insert(roleRows);

    if (roleError) throw roleError;

    const accessRows: any[] = [];

    organization_ids.forEach((orgId: string) => {
      accessRows.push({
        user_id: user.id,
        organization_id: orgId,
        company_id: null,
        site_id: null,
      });
    });

    company_ids.forEach((companyId: string) => {
      accessRows.push({
        user_id: user.id,
        organization_id: null,
        company_id: companyId,
        site_id: null,
      });
    });

    site_ids.forEach((siteId: string) => {
      accessRows.push({
        user_id: user.id,
        organization_id: null,
        company_id: null,
        site_id: siteId,
      });
    });

    if (accessRows.length > 0) {
      const { error: accessError } = await adminSupabase
        .from("user_access_assignments")
        .insert(accessRows);

      if (accessError) throw accessError;
    }

    return NextResponse.json({ user_id: user.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create user." },
      { status: 500 }
    );
  }
}