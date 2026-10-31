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
    const permission = await requirePermission(request, "companies", "add");

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
    const companyName = String(payload.company_name || "").trim();
    const companyCode = String(payload.company_code || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!organizationId) {
      return NextResponse.json(
        { error: "You cannot create companies outside your organization." },
        { status: 403 }
      );
    }

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

    const { data, error } = await admin
      .from("companies")
      .insert({
        organization_id: organizationId,
        company_name: companyName,
        company_code: companyCode,
        status,
      })
      .select("id")
      .single();

    if (error) throw error;

    try {
      await recordAuditEvent(admin, permission.user, {
        organizationId,
        moduleCode: "companies",
        entityType: "company",
        recordId: data.id,
        recordNumber: companyCode,
        action: "create",
        actionCategory: "create",
        activityLabel: "Created Company",
        description: `Created company ${companyName}.`,
        newValues: {
          id: data.id,
          organization_id: organizationId,
          company_name: companyName,
          company_code: companyCode,
          status,
        },
      }, request);
    } catch (auditError) {
      console.error("[Admin Audit] Company create audit failed", auditError);
    }

    return NextResponse.json({ company_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create company." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "companies", "view");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    let query = admin
      .from("companies")
      .select("id, organization_id, company_name, company_code, status, created_at")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });
    if (scope !== null) {
      if (scope.length === 0) return NextResponse.json({ companies: [] });
      query = query.in("organization_id", scope);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const organizationIds = Array.from(new Set(rows.map((row: any) => row.organization_id).filter(Boolean)));
    const organizations = organizationIds.length
      ? await admin.from("organizations").select("id,name,code").in("id", organizationIds)
      : { data: [], error: null };
    if (organizations.error) throw organizations.error;
    const organizationById = new Map((organizations.data || []).map((row: any) => [row.id, row]));
    return NextResponse.json({
      companies: rows.map((row: any) => ({
        ...row,
        organization_name: organizationById.get(row.organization_id)?.name || "",
        organization_code: organizationById.get(row.organization_id)?.code || "",
      })),
    });
  } catch {
    return NextResponse.json({ error: "Could not load companies." }, { status: 500 });
  }
}
