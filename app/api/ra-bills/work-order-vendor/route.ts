import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
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

function isWorkOrderInActorScope(
  workOrder: any,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (!isInOrganizationScope(organizationScope, workOrder?.organization_id)) {
    return false;
  }

  if (assignments.siteIds.length > 0) {
    return assignments.siteIds.includes(workOrder.site_id);
  }

  if (assignments.companyIds.length > 0) {
    return assignments.companyIds.includes(workOrder.company_id);
  }

  return true;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, [
      { moduleCode: "ra_bills", actionCode: "add" },
      { moduleCode: "work_orders", actionCode: "view" },
    ]);

    if ("response" in auth) {
      return auth.response;
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
    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id, company_id, site_id")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work Order was not found." },
        { status: 404 },
      );
    }

    const [organizationScope, assignments] = await Promise.all([
      loadActorOrganizationScope(admin, auth),
      loadActorAssignments(admin, auth.user.id),
    ]);

    if (!isWorkOrderInActorScope(workOrder, organizationScope, assignments)) {
      return NextResponse.json(
        { error: "You do not have access to this Work Order." },
        { status: 403 },
      );
    }

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
