import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requirePermission(request, "vendors", "view");

    if ("response" in access) return access.response;

    const { id } = await params;
    const supabase = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);

    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor || !isInOrganizationScope(organizationScope, vendor.organization_id)) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const { data: activityLogs, error: logsError } = await supabase
      .from("vendor_audit_logs")
      .select(
        "id, vendor_id, organization_id, action, changed_by_user_id, changed_by_email, changed_by_name, changed_at, changed_fields, old_values, new_values, restore_snapshot, note"
      )
      .eq("vendor_id", id)
      .order("changed_at", { ascending: false });

    if (logsError) throw logsError;

    return NextResponse.json({ activityLogs: activityLogs || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load vendor activity." },
      { status: 500 }
    );
  }
}
