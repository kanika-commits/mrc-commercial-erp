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

function parseVisiblePermissionKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item): item is string => item.includes("."))
    )
  );
}

async function deleteScopedRolePermissions(
  admin: ReturnType<typeof adminClient>,
  roleId: string,
  visibleModuleCodes: string[],
  visiblePermissionKeys: string[],
) {
  if (visiblePermissionKeys.length > 0) {
    const moduleCodes = Array.from(
      new Set(visiblePermissionKeys.map((key) => key.split(".")[0]).filter(Boolean))
    );

    if (moduleCodes.length === 0) return;

    const { data: existingRows, error: existingError } = await admin
      .from("role_permissions")
      .select("id, module_code, action_code")
      .eq("role_id", roleId)
      .in("module_code", moduleCodes);

    if (existingError) throw existingError;

    const idsToDelete = (existingRows || [])
      .filter((row) =>
        visiblePermissionKeys.includes(`${row.module_code}.${row.action_code}`)
      )
      .map((row) => row.id)
      .filter(Boolean);

    if (idsToDelete.length > 0) {
      const { error } = await admin
        .from("role_permissions")
        .delete()
        .in("id", idsToDelete);
      if (error) throw error;
    }

    return;
  }

  const deleteQuery = admin
    .from("role_permissions")
    .delete()
    .eq("role_id", roleId);
  const { error } = visibleModuleCodes.length > 0
    ? await deleteQuery.in("module_code", visibleModuleCodes)
    : await deleteQuery;

  if (error) throw error;
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
    const visibleModuleCodes: string[] = Array.isArray(payload.visible_module_codes)
      ? Array.from(
          new Set(
            payload.visible_module_codes
              .map((moduleCode: any) => String(moduleCode || "").trim())
              .filter((moduleCode: string) => Boolean(moduleCode))
          )
        )
      : [];
    const visiblePermissionKeys = parseVisiblePermissionKeys(payload.visible_permission_keys);

    if (!roleId) {
      return NextResponse.json(
        { error: "Select a role first." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    await deleteScopedRolePermissions(admin, roleId, visibleModuleCodes, visiblePermissionKeys);

    const uniqueRows = new Map<string, any>();

    permissions
      .filter(
        (item: any) =>
          item.allowed === true &&
          (visiblePermissionKeys.length > 0
            ? visiblePermissionKeys.includes(`${String(item.module_code || "")}.${String(item.action_code || "")}`)
            : visibleModuleCodes.length > 0
              ? visibleModuleCodes.includes(String(item.module_code || ""))
              : true) &&
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
