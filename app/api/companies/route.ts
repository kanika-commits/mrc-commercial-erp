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

    return NextResponse.json({ company_id: data.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create company." },
      { status: 500 }
    );
  }
}
