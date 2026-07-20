import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertCompanyBankAccountPermission } from "@/lib/serverCompanyBankAccountAccess";
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

async function fetchAccount(supabase: ReturnType<typeof adminClient>, id: string) {
  return supabase
    .from("company_bank_accounts")
    .select(
      "id, organization_id, company_id, bank_name, account_number, ifsc, is_default, status, created_at"
    )
    .eq("id", id)
    .maybeSingle();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertCompanyBankAccountPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const { data: account, error } = await fetchAccount(supabase, id);

    if (error) throw error;

    if (!account) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    if (!isInOrganizationScope(organizationScope, account.organization_id)) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ account });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load bank account." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertCompanyBankAccountPermission(request, "edit");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
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

    const supabase = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const { data: existingAccount, error: existingError } = await fetchAccount(
      supabase,
      id
    );

    if (existingError) throw existingError;

    if (!existingAccount) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    if (!isInOrganizationScope(organizationScope, existingAccount.organization_id)) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    const { data: company, error: companyError } = await supabase
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
        { error: "You cannot move bank accounts outside your organization." },
        { status: 403 }
      );
    }

    if (isDefault) {
      const { error: defaultError } = await supabase
        .from("company_bank_accounts")
        .update({ is_default: false })
        .eq("company_id", companyId)
        .neq("id", id);

      if (defaultError) throw defaultError;
    }

    const { error: updateError } = await supabase
      .from("company_bank_accounts")
      .update({
        organization_id: company.organization_id,
        company_id: companyId,
        bank_name: bankName,
        account_number: accountNumber,
        ifsc,
        is_default: isDefault,
        status,
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ account_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update bank account." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertCompanyBankAccountPermission(request, "delete");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const { data: account, error: accountError } = await fetchAccount(supabase, id);

    if (accountError) throw accountError;

    if (!account) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    if (!isInOrganizationScope(organizationScope, account.organization_id)) {
      return NextResponse.json(
        { error: "Bank account was not found." },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabase
      .from("company_bank_accounts")
      .update({ status: "deleted", is_default: false })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      deleted: false,
      status: "deleted",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete bank account." },
      { status: 500 }
    );
  }
}
