import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertCompanyBankAccountPermission } from "@/lib/serverCompanyBankAccountAccess";
import {
  applyOrganizationScope,
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

export async function POST(request: Request) {
  try {
    const access = await assertCompanyBankAccountPermission(request, "add");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = await request.json();
    const companyId = String(payload.company_id || "").trim();
    const bankName = String(payload.bank_name || "").trim();
    const accountNumber = String(payload.account_number || "").trim();
    const ifsc = String(payload.ifsc || "").trim().toUpperCase();
    const status = String(payload.status || "active").trim() || "active";
    const isDefault = payload.is_default === true;

    if (!companyId) {
      return NextResponse.json({ error: "Company is required." }, { status: 400 });
    }

    if (!bankName) {
      return NextResponse.json({ error: "Bank name is required." }, { status: 400 });
    }

    if (!accountNumber) {
      return NextResponse.json(
        { error: "Account number is required." },
        { status: 400 }
      );
    }

    if (!ifsc) {
      return NextResponse.json({ error: "IFSC is required." }, { status: 400 });
    }

    const admin = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(admin, access.user.id);

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, organization_id")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) throw companyError;

    if (!company) {
      return NextResponse.json(
        { error: "Selected company was not found." },
        { status: 404 }
      );
    }

    if (!isInOrganizationScope(organizationScope, company.organization_id)) {
      return NextResponse.json(
        { error: "You cannot create bank accounts outside your organization." },
        { status: 403 }
      );
    }

    if (isDefault) {
      const { error: defaultError } = await admin
        .from("company_bank_accounts")
        .update({ is_default: false })
        .eq("company_id", companyId);

      if (defaultError) throw defaultError;
    }

    const { data: account, error: insertError } = await admin
      .from("company_bank_accounts")
      .insert({
        organization_id: company.organization_id,
        company_id: companyId,
        bank_name: bankName,
        account_number: accountNumber,
        ifsc,
        is_default: isDefault,
        status,
      })
      .select("id")
      .maybeSingle();

    if (insertError) throw insertError;

    return NextResponse.json({ account });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create bank account." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const access = await assertCompanyBankAccountPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("company_id")?.trim();
    const includeDeleted = searchParams.get("include_deleted") === "true";

    const admin = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(admin, access.user.id);
    let query = applyOrganizationScope(
      admin
        .from("company_bank_accounts")
        .select(
          "id, organization_id, company_id, bank_name, account_number, ifsc, is_default, status, created_at"
        ),
      organizationScope,
    );

    if (!query) {
      return NextResponse.json({ accounts: [] });
    }

    query = query
      .order("bank_name");

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    if (!includeDeleted) {
      query = query.neq("status", "deleted");
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ accounts: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load bank accounts." },
      { status: 500 }
    );
  }
}
