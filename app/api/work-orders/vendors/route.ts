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
    const singleId = searchParams.get("work_order_id")?.trim();
    const ids = (searchParams.get("work_order_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const workOrderIds = singleId ? [singleId] : Array.from(new Set(ids));

    if (workOrderIds.length === 0) {
      return NextResponse.json(
        { error: "work_order_id or work_order_ids is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: links, error: linksError } = await admin
      .from("work_order_vendors")
      .select("work_order_id, vendor_id, vendor_role, is_primary")
      .in("work_order_id", workOrderIds)
      .order("is_primary", { ascending: false });

    if (linksError) throw linksError;

    const primaryLinkByWorkOrder = new Map<string, any>();

    (links || []).forEach((link) => {
      if (!primaryLinkByWorkOrder.has(link.work_order_id)) {
        primaryLinkByWorkOrder.set(link.work_order_id, link);
      }
    });

    const vendorIds = Array.from(
      new Set(
        Array.from(primaryLinkByWorkOrder.values())
          .map((link) => link.vendor_id)
          .filter(Boolean)
      )
    );

    const { data: vendors, error: vendorsError } = vendorIds.length
      ? await admin
          .from("vendors")
          .select("id, vendor_name")
          .in("id", vendorIds)
      : { data: [], error: null };

    if (vendorsError) throw vendorsError;

    const vendorMap = new Map((vendors || []).map((vendor) => [vendor.id, vendor]));
    const workOrderVendors = Object.fromEntries(
      workOrderIds.map((workOrderId) => {
        const link = primaryLinkByWorkOrder.get(workOrderId);
        const vendor = link?.vendor_id ? vendorMap.get(link.vendor_id) : null;

        return [
          workOrderId,
          link?.vendor_id
            ? {
                vendor_id: link.vendor_id,
                vendor_name: vendor?.vendor_name || "-",
                vendor_role: link.vendor_role || "-",
                is_primary: link.is_primary === true,
              }
            : null,
        ];
      })
    );

    return NextResponse.json({ vendors: workOrderVendors });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Work Order vendors." },
      { status: 500 }
    );
  }
}
