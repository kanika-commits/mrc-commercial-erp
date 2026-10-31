import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/lib/auditEvent";
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

    try {
      await recordAuditEvent(admin, permission.user, {
        organizationId,
        moduleCode: "sites",
        entityType: "site",
        recordId: data.id,
        recordNumber: siteCode,
        action: "create",
        actionCategory: "create",
        activityLabel: "Created Site",
        description: `Created site ${siteName}.`,
        newValues: {
          id: data.id,
          organization_id: organizationId,
          site_name: siteName,
          site_code: siteCode,
          location,
          state,
          status,
        },
      }, request);
    } catch (auditError) {
      console.error("[Admin Audit] Site create audit failed", auditError);
    }

    return NextResponse.json({ site_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create site." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "sites", "view");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    let query = admin
      .from("sites")
      .select("id, organization_id, site_name, site_code, location, state, status, created_at, company_id")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });
    if (scope !== null) {
      if (scope.length === 0) return NextResponse.json({ sites: [] });
      query = query.in("organization_id", scope);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ sites: data || [] });
  } catch {
    return NextResponse.json({ error: "Could not load sites." }, { status: 500 });
  }
}
