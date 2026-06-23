import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

const MODULE_CODE = "work_orders";
const ALLOWED_STATUSES = new Set([
  "yet_to_start",
  "active",
  "completed",
  "suspended",
  "terminated",
]);

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireEditPermission(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 } as const;
  }

  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  const { data: userPermissions, error: userPermissionError } = await admin
    .from("user_permissions")
    .select("module_code, action_code, allowed")
    .eq("user_id", user.id);

  if (userPermissionError) throw userPermissionError;

  let roleCodes: string[] = [];
  let rolePermissions: any[] = [];

  if (roleIds.length > 0) {
    const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] =
      await Promise.all([
        admin.from("roles").select("role_code").in("id", roleIds),
        admin
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds),
      ]);

    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;

    roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);
    rolePermissions = permissions || [];
  }

  if (roleCodes.includes("platform_owner")) {
    return { user } as const;
  }

  const allowed = [...rolePermissions, ...(userPermissions || [])].some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === MODULE_CODE && permission.action_code === "edit"))
  );

  if (!allowed) {
    return {
      error: "You do not have permission to edit Work Orders.",
      status: 403,
    } as const;
  }

  return { user } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireEditPermission(request);

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "").trim().toLowerCase();

    if (["approved", "approve"].includes(action)) {
      const permission = await requirePermission(request, MODULE_CODE, "approve");

      if ("response" in permission) {
        return permission.response;
      }

      const userEmail = permission.user.email || "";
      const userName =
        permission.user.user_metadata?.full_name ||
        permission.user.user_metadata?.name ||
        userEmail;

      const admin = adminClient();
      const { error: updateError } = await admin
        .from("work_orders")
        .update({
          approval_status: "approved",
          status: "active",
          approved_by_name: userName,
          approved_by_email: userEmail,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) throw updateError;

      return NextResponse.json({ work_order_id: id, approved: true });
    }

    if (["rejected", "reject"].includes(action)) {
      const permission = await requirePermission(request, MODULE_CODE, "reject");

      if ("response" in permission) {
        return permission.response;
      }

      const admin = adminClient();
      const { data: documents, error: documentLoadError } = await admin
        .from("work_order_documents")
        .select("file_path")
        .eq("work_order_id", id);

      if (documentLoadError) throw documentLoadError;

      const storagePaths = (documents || [])
        .map((document) => document.file_path)
        .filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await admin.storage
          .from("work-order-documents")
          .remove(storagePaths);

        if (storageError) throw storageError;
      }

      const [vendorDelete, documentDelete] = await Promise.all([
        admin.from("work_order_vendors").delete().eq("work_order_id", id),
        admin.from("work_order_documents").delete().eq("work_order_id", id),
      ]);

      if (vendorDelete.error) throw vendorDelete.error;
      if (documentDelete.error) throw documentDelete.error;

      const { error: orderDeleteError } = await admin
        .from("work_orders")
        .delete()
        .eq("id", id);

      if (orderDeleteError) throw orderDeleteError;

      return NextResponse.json({ work_order_id: id, rejected: true, deleted: true });
    }

    const status = String(payload.status || "").trim().toLowerCase();

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "Invalid Work Order status." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work Order was not found." },
        { status: 404 }
      );
    }

    const { error: updateError } = await admin
      .from("work_orders")
      .update({ status })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ work_order_id: id, status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update Work Order status." },
      { status: 500 }
    );
  }
}
