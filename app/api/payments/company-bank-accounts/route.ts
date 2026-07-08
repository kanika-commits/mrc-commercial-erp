import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean)),
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean)),
    ) as string[],
  };
}

async function loadCompanyIdsForSites(
  admin: ReturnType<typeof adminClient>,
  organizationScope: string[] | null,
  siteIds: string[],
) {
  if (siteIds.length === 0) return [];

  let query = admin
    .from("sites")
    .select("company_id, organization_id")
    .in("id", siteIds);

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return [];

  query = scopedQuery;

  const { data, error } = await query;
  if (error) throw error;

  return Array.from(
    new Set((data || []).map((site) => site.company_id).filter(Boolean)),
  ) as string[];
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "payments", "add");
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("company_id")?.trim() || "";
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAssignments(admin, auth.user.id);
    const scopedCompanyIds =
      assignments.siteIds.length > 0
        ? await loadCompanyIdsForSites(admin, organizationScope, assignments.siteIds)
        : assignments.companyIds;

    if (companyId && scopedCompanyIds.length > 0 && !scopedCompanyIds.includes(companyId)) {
      return NextResponse.json({ accounts: [] });
    }

    let query = admin
      .from("company_bank_accounts")
      .select("id, organization_id, company_id, bank_name, account_number, ifsc, is_default, status")
      .eq("status", "active")
      .order("bank_name");

    const scopedQuery = applyOrganizationScope(query, organizationScope);
    if (!scopedQuery) {
      return NextResponse.json({ accounts: [] });
    }

    query = scopedQuery;

    if (companyId) {
      query = query.eq("company_id", companyId);
    } else if (scopedCompanyIds.length > 0) {
      query = query.in("company_id", scopedCompanyIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ accounts: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load payment bank accounts." },
      { status: 500 },
    );
  }
}
