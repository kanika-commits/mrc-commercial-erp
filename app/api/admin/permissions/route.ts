import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { isValidPermissionAction } from "@/lib/permissionMatrix";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function PUT(request: Request) {
  try {
    const permission = await requireAnyPermission(request, [
      { moduleCode: "permissions", actionCode: "edit" },
      { moduleCode: "roles", actionCode: "edit" },
    ]);

    if ("response" in permission) {
      return permission.response;
    }

    const payload = await request.json().catch(() => ({}));
    const roleId = String(payload.role_id || "").trim();
    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions
      : [];

    if (!roleId) {
      return NextResponse.json(
        { error: "Select a role first." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { error: deleteError } = await admin
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteError) throw deleteError;

    const uniqueRows = new Map<string, any>();

    permissions
      .filter(
        (item: any) =>
          item.allowed === true &&
          isValidPermissionAction(
            String(item.module_code || ""),
            String(item.action_code || ""),
          ),
      )
      .forEach((item: any) => {
        uniqueRows.set(`${item.module_code}.${item.action_code}`, {
          role_id: roleId,
          module_code: item.module_code,
          action_code: item.action_code,
          allowed: true,
        });
      });

    const rows = Array.from(uniqueRows.values());

    if (rows.length > 0) {
      const { error: insertError } = await admin
        .from("role_permissions")
        .insert(rows);

      if (insertError) throw insertError;
    }

    return NextResponse.json({ saved: true, count: rows.length });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save permissions." },
      { status: 500 }
    );
  }
}
