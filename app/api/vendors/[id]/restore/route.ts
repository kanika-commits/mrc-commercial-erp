import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isInOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";

const RESTORE_FIELDS = [
  "vendor_name",
  "contractor_type",
  "status",
  "pan",
  "aadhaar_cin",
  "gstin",
  "pan_aadhaar_link_status",
  "msme_registered",
  "msme_number",
  "msme_category",
  "is_deleted",
] as const;

const AUDIT_FIELDS = [
  "organization_id",
  ...RESTORE_FIELDS,
] as const;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function vendorSnapshot(row: any) {
  return Object.fromEntries(
    AUDIT_FIELDS.map((field) => [field, row?.[field] ?? null])
  );
}

function changedVendorValues(oldRow: any, newRow: any) {
  const changedFields: string[] = [];
  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  AUDIT_FIELDS.forEach((field) => {
    const oldValue = oldRow?.[field] ?? null;
    const newValue = newRow?.[field] ?? null;

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changedFields.push(field);
      oldValues[field] = oldValue;
      newValues[field] = newValue;
    }
  });

  return { changedFields, oldValues, newValues };
}

function actorName(user: any) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    null
  );
}

async function authenticate(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return {
      response: NextResponse.json({ error: "Missing auth token." }, { status: 401 }),
    } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return {
      response: NextResponse.json({ error: "User not found." }, { status: 401 }),
    } as const;
  }

  return { user } as const;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(request);

    if ("response" in auth) return auth.response;

    const { id } = await params;
    const { audit_log_id } = await request.json();

    if (!audit_log_id) {
      return NextResponse.json({ error: "Audit log id is required." }, { status: 400 });
    }

    const supabase = adminClient();
    const { data: userRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role_id")
      .eq("user_id", auth.user.id);

    if (rolesError) throw rolesError;

    const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);
    const { data: roles, error: roleCodesError } = roleIds.length
      ? await supabase.from("roles").select("role_code").in("id", roleIds)
      : { data: [], error: null };

    if (roleCodesError) throw roleCodesError;

    const roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);
    const isRecoveryAdmin =
      roleCodes.includes("platform_owner") || roleCodes.includes("super_admin");

    if (!isRecoveryAdmin) {
      return NextResponse.json(
        { error: "Only Super Admin or Platform Owner can restore vendor versions." },
        { status: 403 }
      );
    }

    const organizationScope = await loadOrganizationScopeForUser(supabase, auth.user.id);
    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor || !isInOrganizationScope(organizationScope, vendor.organization_id)) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const { data: auditLog, error: auditError } = await supabase
      .from("vendor_audit_logs")
      .select("id, vendor_id, changed_at, restore_snapshot")
      .eq("id", audit_log_id)
      .eq("vendor_id", id)
      .maybeSingle();

    if (auditError) throw auditError;

    if (!auditLog?.restore_snapshot) {
      return NextResponse.json(
        { error: "Selected activity log does not have a restorable snapshot." },
        { status: 400 }
      );
    }

    const snapshot = auditLog.restore_snapshot as Record<string, any>;
    const restorePayload = Object.fromEntries(
      RESTORE_FIELDS.map((field) => [field, snapshot[field] ?? null])
    );

    const { error: restoreError } = await supabase
      .from("vendors")
      .update(restorePayload)
      .eq("id", id);

    if (restoreError) throw restoreError;

    const { data: restoredVendor, error: restoredVendorError } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", id)
      .single();

    if (restoredVendorError) throw restoredVendorError;

    const changes = changedVendorValues(vendor, restoredVendor);

    const { error: logError } = await supabase.from("vendor_audit_logs").insert({
      vendor_id: id,
      organization_id: restoredVendor.organization_id,
      action: "restored",
      changed_by_user_id: auth.user.id,
      changed_by_email: auth.user.email || null,
      changed_by_name: actorName(auth.user),
      changed_fields: changes.changedFields,
      old_values: changes.oldValues,
      new_values: changes.newValues,
      restore_snapshot: vendorSnapshot(vendor),
      note: `Restored vendor to version from ${auditLog.changed_at} (source audit log: ${auditLog.id})`,
    });

    if (logError) throw logError;

    return NextResponse.json({ vendor_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to restore vendor version." },
      { status: 500 }
    );
  }
}
