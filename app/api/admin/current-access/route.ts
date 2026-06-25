import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }

    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    }

    const authClient = createClient(supabaseUrl, anonKey);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 401 });
    }

    const [userRoles, userPermissions, accessRows] = await Promise.all([
      adminClient.from("user_roles").select("role_id").eq("user_id", user.id),
      adminClient
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", user.id),
      adminClient
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", user.id),
    ]);

    for (const result of [userRoles, userPermissions, accessRows]) {
      if (result.error) throw result.error;
    }

    const roleIds = (userRoles.data || []).map((row) => row.role_id).filter(Boolean);

    let roleCodes: string[] = [];
    let rolePermissionRows: any[] = [];

    if (roleIds.length > 0) {
      const [roles, rolePermissions] = await Promise.all([
        adminClient.from("roles").select("role_code").in("id", roleIds),
        adminClient
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds),
      ]);

      if (roles.error) throw roles.error;
      if (rolePermissions.error) throw rolePermissions.error;

      roleCodes = (roles.data || []).map((role) => role.role_code).filter(Boolean);
      rolePermissionRows = rolePermissions.data || [];
    }

    const isWildcard = roleCodes.includes("platform_owner");

    if (isWildcard) {
      return NextResponse.json({
        user,
        roleCodes,
        permissions: [{ module_code: "*", action_code: "*", allowed: true }],
        organizations: [],
        companies: [],
        sites: [],
        isGlobalAccess: true,
      });
    }

    const permissionMap = new Map<string, any>();

    [...rolePermissionRows, ...(userPermissions.data || [])].forEach((permission) => {
      permissionMap.set(
        `${permission.module_code}:${permission.action_code}`,
        permission
      );
    });

    return NextResponse.json({
      user,
      roleCodes,
      permissions: Array.from(permissionMap.values()),
      organizations: Array.from(
        new Set((accessRows.data || []).map((row) => row.organization_id).filter(Boolean))
      ),
      companies: Array.from(
        new Set((accessRows.data || []).map((row) => row.company_id).filter(Boolean))
      ),
      sites: Array.from(
        new Set((accessRows.data || []).map((row) => row.site_id).filter(Boolean))
      ),
      isGlobalAccess: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load user access." },
      { status: 500 }
    );
  }
}
