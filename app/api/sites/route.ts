import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  loadActorOrganizationScope,
  resolveWriteOrganizationId,
} from "@/lib/serverOrganizationScope";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function POST(request: Request) {
  try {
    const permission = await requirePermission(request, "sites", "add");

    if ("response" in permission) {
      return permission.response;
    }

    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, permission);
    const organizationId = resolveWriteOrganizationId(
      organizationScope,
      payload.organization_id
    );
    const siteName = String(payload.site_name || "").trim();
    const siteCode = String(payload.site_code || "").trim();
    const location = String(payload.location || "").trim();
    const state = String(payload.state || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!organizationId) {
      return NextResponse.json(
        { error: "You cannot create sites outside your organization." },
        { status: 403 }
      );
    }

    if (!siteName) {
      return NextResponse.json(
        { error: "Site name is required." },
        { status: 400 }
      );
    }

    if (!siteCode) {
      return NextResponse.json(
        { error: "Site code is required." },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("sites")
      .insert({
        organization_id: organizationId,
        site_name: siteName,
        site_code: siteCode,
        location: location || null,
        state: state || null,
        status,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ site_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create site." },
      { status: 500 }
    );
  }
}
