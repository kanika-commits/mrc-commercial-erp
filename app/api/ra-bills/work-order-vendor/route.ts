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

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const workOrderId = searchParams.get("work_order_id")?.trim();

    if (!workOrderId) {
      return NextResponse.json(
        { error: "work_order_id is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: vendorLinks, error: vendorLinksError } = await admin
      .from("work_order_vendors")
      .select("id, vendor_id, vendor_role, is_primary")
      .eq("work_order_id", workOrderId)
      .order("is_primary", { ascending: false });

    if (vendorLinksError) throw vendorLinksError;

    const primaryVendorLink =
      vendorLinks?.find((row) => row.is_primary) || vendorLinks?.[0];

    if (!primaryVendorLink?.vendor_id) {
      return NextResponse.json(
        { error: "No vendor is linked to this Work Order." },
        { status: 404 }
      );
    }

    const { data: vendor, error: vendorError } = await admin
      .from("vendors")
      .select("id, vendor_name")
      .eq("id", primaryVendorLink.vendor_id)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor?.id) {
      return NextResponse.json(
        { error: "Linked vendor was not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      vendor_id: vendor.id,
      vendor_name: vendor.vendor_name || "-",
      vendor_role: primaryVendorLink.vendor_role || "-",
      is_primary: primaryVendorLink.is_primary === true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to resolve Work Order vendor." },
      { status: 500 }
    );
  }
}
