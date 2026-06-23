import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeletePermission } from "@/lib/serverDeleteAudit";
import { requirePermission } from "@/lib/serverPermissions";

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
    const auth = await requirePermission(request, "work_orders", "view");

    if ("response" in auth) {
      return auth.response;
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
      .select("id, work_order_id, vendor_id, vendor_role, is_primary")
      .in("work_order_id", workOrderIds)
      .order("is_primary", { ascending: false });

    if (linksError) throw linksError;

    const linksByWorkOrder = new Map<string, any[]>();
    const primaryLinkByWorkOrder = new Map<string, any>();

    (links || []).forEach((link) => {
      const rows = linksByWorkOrder.get(link.work_order_id) || [];
      rows.push(link);
      linksByWorkOrder.set(link.work_order_id, rows);

      if (!primaryLinkByWorkOrder.has(link.work_order_id)) {
        primaryLinkByWorkOrder.set(link.work_order_id, link);
      }
    });

    const vendorIds = Array.from(
      new Set(
        (links || [])
          .map((link) => link.vendor_id)
          .filter(Boolean)
      )
    );

    const { data: vendors, error: vendorsError } = vendorIds.length
      ? await admin
          .from("vendors")
          .select("id, vendor_name, vendor_type, pan, gstin")
          .in("id", vendorIds)
      : { data: [], error: null };

    if (vendorsError) throw vendorsError;

    const { data: contacts, error: contactsError } = vendorIds.length
      ? await admin
          .from("vendor_contacts")
          .select("vendor_id, contact_name, contact_number, email, designation, is_primary")
          .in("vendor_id", vendorIds)
          .order("is_primary", { ascending: false })
      : { data: [], error: null };

    if (contactsError) throw contactsError;

    const vendorMap = new Map((vendors || []).map((vendor) => [vendor.id, vendor]));
    const contactMap = new Map<string, any>();
    (contacts || []).forEach((contact) => {
      if (!contact.vendor_id || contactMap.has(contact.vendor_id)) return;
      contactMap.set(contact.vendor_id, contact);
    });
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

    const allVendors = Object.fromEntries(
      workOrderIds.map((workOrderId) => [
        workOrderId,
        (linksByWorkOrder.get(workOrderId) || []).map((link) => {
          const vendor = link.vendor_id ? vendorMap.get(link.vendor_id) : null;

          return {
            id: link.id,
            vendor_id: link.vendor_id,
            vendor_role: link.vendor_role || "-",
            is_primary: link.is_primary === true,
            vendor: vendor
              ? {
                  id: vendor.id,
                  vendor_name: vendor.vendor_name,
                  vendor_type: vendor.vendor_type,
                  pan: vendor.pan,
                  gstin: vendor.gstin,
                  primary_contact: contactMap.get(vendor.id) || null,
                }
              : null,
          };
        }),
      ])
    );

    return NextResponse.json({ vendors: workOrderVendors, all_vendors: allVendors });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Work Order vendors." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit");

    if ("response" in auth) {
      return auth.response;
    }

    const body = await request.json().catch(() => ({}));
    const workOrderId = String(body.work_order_id || "").trim();
    const vendorId = String(body.vendor_id || "").trim();
    const vendorRole = String(body.vendor_role || "Subcontractor").trim();

    if (!workOrderId) {
      return NextResponse.json({ error: "work_order_id is required." }, { status: 400 });
    }

    if (!vendorId) {
      return NextResponse.json({ error: "vendor_id is required." }, { status: 400 });
    }

    const admin = adminClient();
    const [{ data: workOrder, error: workOrderError }, { data: vendor, error: vendorError }] =
      await Promise.all([
        admin
          .from("work_orders")
          .select("id, organization_id")
          .eq("id", workOrderId)
          .maybeSingle(),
        admin.from("vendors").select("id").eq("id", vendorId).maybeSingle(),
      ]);

    if (workOrderError) throw workOrderError;
    if (vendorError) throw vendorError;

    if (!workOrder) {
      return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    }

    if (!vendor) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const { data: existingLink, error: existingError } = await admin
      .from("work_order_vendors")
      .select("id")
      .eq("work_order_id", workOrderId)
      .eq("vendor_id", vendorId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingLink) {
      return NextResponse.json(
        { error: "This vendor is already linked to this Work Order." },
        { status: 409 }
      );
    }

    const { data: link, error: linkError } = await admin
      .from("work_order_vendors")
      .insert({
        organization_id: workOrder.organization_id,
        work_order_id: workOrderId,
        vendor_id: vendorId,
        vendor_role: vendorRole || "Subcontractor",
        is_primary: false,
      })
      .select("id")
      .single();

    if (linkError) throw linkError;

    return NextResponse.json({ linked: true, link_id: link.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to link Work Order vendor." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit");

    if ("response" in auth) {
      return auth.response;
    }

    const body = await request.json().catch(() => ({}));
    const linkId = String(body.link_id || "").trim();
    const workOrderId = String(body.work_order_id || "").trim();
    const vendorId = String(body.vendor_id || "").trim();

    if (!linkId && (!workOrderId || !vendorId)) {
      return NextResponse.json(
        { error: "link_id or work_order_id and vendor_id are required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const permission = await requireDeletePermission(
      admin,
      auth.user,
      "work_orders"
    );

    if ("error" in permission) {
      return NextResponse.json(
        { error: permission.error },
        { status: permission.status }
      );
    }

    let query = admin
      .from("work_order_vendors")
      .select("id, work_order_id, vendor_id, vendor_role, is_primary")
      .limit(1);

    if (linkId) {
      query = query.eq("id", linkId);
    } else {
      query = query.eq("work_order_id", workOrderId).eq("vendor_id", vendorId);
    }

    const { data: links, error: linkError } = await query;

    if (linkError) throw linkError;

    const link = links?.[0];

    if (!link) {
      return NextResponse.json(
        { error: "Work Order vendor link was not found." },
        { status: 404 }
      );
    }

    const role = String(link.vendor_role || "").toLowerCase();
    const isMainVendor =
      link.is_primary === true ||
      role.includes("main") ||
      role.includes("primary");

    if (isMainVendor) {
      return NextResponse.json(
        { error: "Main vendor cannot be removed from the Work Order here." },
        { status: 400 }
      );
    }

    const { error: deleteError } = await admin
      .from("work_order_vendors")
      .delete()
      .eq("id", link.id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ removed: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to remove Work Order vendor link." },
      { status: 500 }
    );
  }
}
