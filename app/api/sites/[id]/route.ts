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

async function assertEditPermission(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  if (roleIds.length === 0) {
    return { error: "You do not have permission to edit sites.", status: 403 };
  }

  const { data: roles, error: rolesError } = await admin
    .from("roles")
    .select("id, role_code")
    .in("id", roleIds);

  if (rolesError) throw rolesError;

  const roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return { user };
  }

  const [
    { data: rolePermissions, error: rolePermissionError },
    { data: userPermissions, error: userPermissionError },
  ] = await Promise.all([
    admin
      .from("role_permissions")
      .select("module_code, action_code, allowed")
      .in("role_id", roleIds),
    admin
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", user.id),
  ]);

  if (rolePermissionError) throw rolePermissionError;
  if (userPermissionError) throw userPermissionError;

  const permissionMap = new Map<string, boolean>();

  [...(rolePermissions || []), ...(userPermissions || [])].forEach((permission) => {
    permissionMap.set(
      `${permission.module_code}:${permission.action_code}`,
      permission.allowed === true
    );
  });

  const allowed =
    permissionMap.get("*:*") === true ||
    permissionMap.get("sites:edit") === true;

  if (!allowed) {
    return { error: "You do not have permission to edit sites.", status: 403 };
  }

  return { user };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertEditPermission(request);

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const payload = await request.json();
    const siteName = String(payload.site_name || "").trim();
    const siteCode = String(payload.site_code || "").trim().toUpperCase();
    const location = payload.location ? String(payload.location).trim() : null;
    const state = payload.state ? String(payload.state).trim() : null;
    const status = String(payload.status || "active").trim() || "active";

    if (!siteName) {
      return NextResponse.json({ error: "Site name is required." }, { status: 400 });
    }

    if (!siteCode) {
      return NextResponse.json({ error: "Site code is required." }, { status: 400 });
    }

    const supabase = adminClient();
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (siteError) throw siteError;

    if (!site) {
      return NextResponse.json({ error: "Site was not found." }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("sites")
      .update({
        site_name: siteName,
        site_code: siteCode,
        location,
        state,
        status,
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ site_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update site." },
      { status: 500 }
    );
  }
}
