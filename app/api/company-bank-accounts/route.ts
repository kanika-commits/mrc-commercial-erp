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

async function requireUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  return { user };
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const payload = await request.json();
    const companyId = String(payload.company_id || "").trim();
    const bankName = String(payload.bank_name || "").trim();
    const accountNumber = String(payload.account_number || "").trim();
    const ifsc = String(payload.ifsc || "").trim().toUpperCase();
    const status = String(payload.status || "active").trim() || "active";
    const isDefault = payload.is_default === true;

    if (!companyId) {
      return NextResponse.json(
        { error: "Company is required." },
        { status: 400 }
      );
    }

    if (!bankName) {
      return NextResponse.json(
        { error: "Bank name is required." },
        { status: 400 }
      );
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
