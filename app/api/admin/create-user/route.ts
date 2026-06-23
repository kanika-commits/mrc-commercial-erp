import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function uniqueRows<T>(rows: T[], keyFor: (row: T) => string) {
  return Array.from(new Map(rows.map((row) => [keyFor(row), row])).values());
}

export async function POST(request: Request) {
  try {
    const permission = await requirePermission(request, "users", "add");

    if ("response" in permission) {
      return permission.response;
    }

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

    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
    const normalizedEmail = normalizeEmail(email);

    const { data: existingUsers, error: listUsersError } =
      await adminSupabase.auth.admin.listUsers();

    if (listUsersError) throw listUsersError;

    let user = existingUsers.users.find(
      (item) => item.email?.toLowerCase() === normalizedEmail
    );

    if (!user) {
      const { data: authData, error: authError } =
        await adminSupabase.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
          user_metadata: {
            full_name,
          },
        });

      if (authError) throw authError;
      user = authData.user || undefined;
    }

    if (!user) {
      throw new Error("User was not created.");
    }

    const { error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: normalizedEmail,
        full_name,
        status: "active",
      });

    if (profileError) throw profileError;

    await adminSupabase.from("user_roles").delete().eq("user_id", user.id);

    const roleRows = uniqueRows<RoleRow>(
      role_ids.map((roleId: string) => ({
        user_id: user.id,
        role_id: roleId,
      })),
      (row) => `${row.user_id}.${row.role_id}`
    );

    const { error: roleError } = await adminSupabase
      .from("user_roles")
      .insert(roleRows);

    if (roleError) throw roleError;

    const { data: siteData, error: siteError } = (site_ids || []).length
      ? await adminSupabase
          .from("sites")
          .select("id, company_id")
          .in("id", site_ids || [])
      : { data: [], error: null };

    if (siteError) throw siteError;

    const companyIds = Array.from(
      new Set([
        ...(company_ids || []),
        ...(siteData || []).map((site) => site.company_id).filter(Boolean),
      ])
    );

    const { data: companyData, error: companyError } = companyIds.length
      ? await adminSupabase
          .from("companies")
          .select("id, organization_id")
          .in("id", companyIds)
      : { data: [], error: null };

    if (companyError) throw companyError;

    const companyById = new Map((companyData || []).map((item) => [item.id, item]));
    const siteById = new Map((siteData || []).map((item) => [item.id, item]));

    const accessRows: AccessRow[] = [];

    (organization_ids || []).forEach((orgId: string) => {
      accessRows.push({
        user_id: user.id,
        organization_id: orgId,
        company_id: null,
        site_id: null,
      });
    });

    (company_ids || []).forEach((companyId: string) => {
      const company = companyById.get(companyId);

      accessRows.push({
        user_id: user.id,
        organization_id: company?.organization_id || null,
        company_id: companyId,
        site_id: null,
      });
    });

    (site_ids || []).forEach((siteId: string) => {
      const site = siteById.get(siteId);
      const company = site ? companyById.get(site.company_id) : null;
      const fallbackOrganizationId =
        company?.organization_id || organization_ids?.[0] || null;

      accessRows.push({
        user_id: user.id,
        organization_id: fallbackOrganizationId,
        company_id: site?.company_id || null,
        site_id: siteId,
      });
    });

    const uniqueAccessRows = uniqueRows<AccessRow>(
      accessRows,
      (row) => `${row.user_id}.${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
    );

    await adminSupabase
      .from("user_access_assignments")
      .delete()
      .eq("user_id", user.id);

    if (uniqueAccessRows.length > 0) {
      const { error: accessError } = await adminSupabase
        .from("user_access_assignments")
        .insert(uniqueAccessRows);

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
