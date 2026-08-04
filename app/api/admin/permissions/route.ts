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

type ParsedVisiblePermissionKeys = {
  error: string | null;
  keys: string[];
};

type PermissionRow = {
  role_id: string;
  module_code: string;
  action_code: string;
  allowed: true;
};

function parseVisiblePermissionKeys(value: unknown): ParsedVisiblePermissionKeys {
  if (!Array.isArray(value)) {
    return {
      error: "visible_permission_keys is required for role permission updates.",
      keys: [],
    };
  }

  const keys: string[] = [];
  for (const item of value) {
    const permissionKey = String(item || "").trim();
    const parts = permissionKey.split(":");
    if (
      parts.length !== 2 ||
      !parts[0]?.trim() ||
      !parts[1]?.trim() ||
      !isValidPermissionAction(parts[0].trim(), parts[1].trim())
    ) {
      return {
        error: "visible_permission_keys contains an invalid permission key.",
        keys: [],
      };
    }
    keys.push(`${parts[0].trim()}:${parts[1].trim()}`);
  }

  const dedupedKeys = Array.from(new Set(keys));
  if (dedupedKeys.length === 0) {
    return {
      error: "visible_permission_keys is required for role permission updates.",
      keys: [],
    };
  }

  return { error: null, keys: dedupedKeys };
}

async function deleteVisibleRolePermissions(
  admin: ReturnType<typeof adminClient>,
  roleId: string,
  visiblePermissionKeys: string[],
) {
  if (visiblePermissionKeys.length === 0) return;

  const moduleCodes = Array.from(
    new Set(visiblePermissionKeys.map((key) => key.split(":")[0]).filter(Boolean)),
  );
  if (moduleCodes.length === 0) return;

  const { data, error } = await admin
    .from("role_permissions")
    .select("id, module_code, action_code")
    .eq("role_id", roleId)
    .in("module_code", moduleCodes);

  if (error) throw error;

  const idsToDelete = (data || [])
    .filter((row) => visiblePermissionKeys.includes(`${row.module_code}:${row.action_code}`))
    .map((row) => row.id)
    .filter(Boolean);

  if (idsToDelete.length === 0) return;

  const { error: deleteError } = await admin
    .from("role_permissions")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) throw deleteError;
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
    if (!Array.isArray(payload.permissions)) {
      return NextResponse.json(
        { error: "permissions must be an array." },
        { status: 400 }
      );
    }

    const permissions = payload.permissions;
    const parsedVisiblePermissionKeys = parseVisiblePermissionKeys(payload.visible_permission_keys);

    if (parsedVisiblePermissionKeys.error) {
      return NextResponse.json(
        { error: parsedVisiblePermissionKeys.error },
        { status: 400 }
      );
    }

    const visiblePermissionKeys = parsedVisiblePermissionKeys.keys;
    const visiblePermissionKeySet = new Set(visiblePermissionKeys);

    if (!roleId) {
      return NextResponse.json(
        { error: "Select a role first." },
        { status: 400 }
      );
    }

    const uniqueRows = new Map<string, PermissionRow>();

    for (const item of permissions) {
      if (!item || typeof item !== "object" || item.allowed !== true) {
        return NextResponse.json(
          { error: "permissions contains an invalid permission row." },
          { status: 400 }
        );
      }

      const moduleCode = String(item.module_code || "").trim();
      const actionCode = String(item.action_code || "").trim();
      const permissionKey = `${moduleCode}:${actionCode}`;

      if (
        !moduleCode ||
        !actionCode ||
        !isValidPermissionAction(moduleCode, actionCode) ||
        !visiblePermissionKeySet.has(permissionKey)
      ) {
        return NextResponse.json(
          { error: "permissions contains an invalid or non-visible permission row." },
          { status: 400 }
        );
      }

      uniqueRows.set(permissionKey, {
        role_id: roleId,
        module_code: moduleCode,
        action_code: actionCode,
        allowed: true,
      });
    }

    const admin = adminClient();
    await deleteVisibleRolePermissions(admin, roleId, visiblePermissionKeys);

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
