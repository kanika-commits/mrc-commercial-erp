import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Permission = {
  module_code: string;
  action_code: string;
  allowed: boolean;
};

function hasWildcardPermission(permissions: Permission[]) {
  return permissions.some(
    (permission) =>
      permission.allowed === true &&
      permission.module_code === "*" &&
      permission.action_code === "*"
  );
}

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
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 401 });
    }

    const [userRoles, userPermissions, accessRows] = await Promise.all([
      admin.from("user_roles").select("role_id").eq("user_id", user.id),
      admin
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", user.id),
      admin
        .from("user_access_assignments")
        .select("site_id")
        .eq("user_id", user.id),
    ]);

    for (const result of [userRoles, userPermissions, accessRows]) {
      if (result.error) throw result.error;
    }

    const roleIds = (userRoles.data || [])
      .map((row) => row.role_id)
      .filter(Boolean);

    let roleCodes: string[] = [];
    let rolePermissions: Permission[] = [];

    if (roleIds.length > 0) {
      const [roles, permissions] = await Promise.all([
        admin.from("roles").select("role_code").in("id", roleIds),
        admin
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds),
      ]);

      if (roles.error) throw roles.error;
      if (permissions.error) throw permissions.error;

      roleCodes = (roles.data || [])
        .map((role) => role.role_code)
        .filter(Boolean);
      rolePermissions = permissions.data || [];
    }

    const permissions = [...rolePermissions, ...((userPermissions.data || []) as Permission[])];
    const isSuperUser =
      roleCodes.includes("platform_owner") ||
      roleCodes.includes("super_admin") ||
      hasWildcardPermission(permissions);
    const restrictedSiteIds = isSuperUser
      ? []
      : Array.from(
          new Set((accessRows.data || []).map((row) => row.site_id).filter(Boolean))
        );
    let allowedWorkOrderIds: string[] | null = null;

    if (restrictedSiteIds.length > 0) {
      const { data: allowedWorkOrders, error: allowedWorkOrdersError } =
        await admin
          .from("work_orders")
          .select("id")
          .in("site_id", restrictedSiteIds);

      if (allowedWorkOrdersError) throw allowedWorkOrdersError;

      allowedWorkOrderIds = (allowedWorkOrders || [])
        .map((workOrder) => workOrder.id)
        .filter(Boolean);
    }

    const applyWorkOrderScope = (query: any, column = "work_order_id") => {
      if (allowedWorkOrderIds === null) return query;
      if (allowedWorkOrderIds.length === 0) return null;
      return query.in(column, allowedWorkOrderIds);
    };

    const pendingWorkOrdersQuery = applyWorkOrderScope(
      admin
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .ilike("approval_status", "pending"),
      "id"
    );
    const pendingRaBillsQuery = applyWorkOrderScope(
      admin
        .from("ra_bills")
        .select("id", { count: "exact", head: true })
        .ilike("approval_status", "pending")
    );
    const pendingDebitNotesQuery = applyWorkOrderScope(
      admin
        .from("debit_notes")
        .select("id", { count: "exact", head: true })
        .ilike("approval_status", "pending")
    );
    const pendingItcQuery = applyWorkOrderScope(
      admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .or("itc_status.is.null,itc_status.ilike.pending")
    );
    const pendingInvoiceApprovalsQuery = applyWorkOrderScope(
      admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .ilike("approval_status", "pending")
    );

    const [
      pendingWorkOrders,
      pendingRaBills,
      pendingDebitNotes,
      pendingItcReview,
      pendingInvoiceApprovals,
    ] = await Promise.all([
      pendingWorkOrdersQuery || Promise.resolve({ count: 0, error: null }),
      pendingRaBillsQuery || Promise.resolve({ count: 0, error: null }),
      pendingDebitNotesQuery || Promise.resolve({ count: 0, error: null }),
      pendingItcQuery || Promise.resolve({ count: 0, error: null }),
      pendingInvoiceApprovalsQuery || Promise.resolve({ count: 0, error: null }),
    ]);

    for (const result of [
      pendingWorkOrders,
      pendingRaBills,
      pendingDebitNotes,
      pendingItcReview,
      pendingInvoiceApprovals,
    ]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      pendingWorkOrders: pendingWorkOrders.count || 0,
      pendingRaBills: pendingRaBills.count || 0,
      pendingDebitNotes: pendingDebitNotes.count || 0,
      pendingItcReview: pendingItcReview.count || 0,
      pendingInvoiceApprovals: pendingInvoiceApprovals.count || 0,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load notification counts." },
      { status: 500 }
    );
  }
}
