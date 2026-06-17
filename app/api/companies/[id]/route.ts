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

async function assertPermission(
  request: Request,
  actionCode: "edit" | "delete"
) {
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
    return { error: "You do not have permission to manage companies.", status: 403 };
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
    permissionMap.get(`companies:${actionCode}`) === true;

  if (!allowed) {
    return { error: "You do not have permission to manage companies.", status: 403 };
  }

  return { user };
}

async function getDependencyCount(
  supabase: ReturnType<typeof adminClient>,
  table: string,
  column: string,
  value: string
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);

  if (error) throw error;

  return count || 0;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "edit");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const payload = await request.json();
    const companyName = String(payload.company_name || "").trim();
    const companyCode = String(payload.company_code || "").trim().toUpperCase();
    const status = String(payload.status || "active").trim() || "active";

    if (!companyName) {
      return NextResponse.json(
        { error: "Company name is required." },
        { status: 400 }
      );
    }

    if (!companyCode) {
      return NextResponse.json(
        { error: "Company code is required." },
        { status: 400 }
      );
    }

    const supabase = adminClient();
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (companyError) throw companyError;

    if (!company) {
      return NextResponse.json({ error: "Company was not found." }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        company_name: companyName,
        company_code: companyCode,
        status,
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ company_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update company." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "delete");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (companyError) throw companyError;

    if (!company) {
      return NextResponse.json({ error: "Company was not found." }, { status: 404 });
    }

    const [sites, workOrders, bankAccounts] = await Promise.all([
      getDependencyCount(supabase, "sites", "company_id", id),
      getDependencyCount(supabase, "work_orders", "company_id", id),
      getDependencyCount(supabase, "company_bank_accounts", "company_id", id),
    ]);

    let payments = 0;

    const { data: accountIds, error: accountError } = await supabase
      .from("company_bank_accounts")
      .select("id")
      .eq("company_id", id);

    if (accountError) throw accountError;

    const bankAccountIds = (accountIds || []).map((account) => account.id);

    if (bankAccountIds.length > 0) {
      const { count, error: paymentError } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("company_bank_account_id", bankAccountIds);

      if (paymentError) throw paymentError;
      payments = count || 0;
    }

    const blockers = [
      sites > 0 ? `${sites} site(s)` : "",
      workOrders > 0 ? `${workOrders} work order(s)` : "",
      bankAccounts > 0 ? `${bankAccounts} bank account(s)` : "",
      payments > 0 ? `${payments} payment(s)` : "",
    ].filter(Boolean);

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete Company because linked ${blockers.join(", ")} exist.`,
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("companies")
      .update({ status: "deleted" })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, status: "deleted" });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete company." },
      { status: 500 }
    );
  }
}
