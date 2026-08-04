import { NextResponse } from "next/server";
import { jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_contractors", "add");
    if ("response" in access) return access.response;

    const vendorQuery = applyOrganizationScope(
      access.admin
        .from("vendors")
        .select("id, organization_id, vendor_name, pan, gstin, status")
        .neq("status", "deleted")
        .order("vendor_name", { ascending: true }),
      access.organizationScope,
    );
    if (!vendorQuery) return NextResponse.json({ vendors: [] });

    const profileQuery = applyOrganizationScope(
      access.admin
        .from("labour_contractor_profiles")
        .select("vendor_id")
        .not("vendor_id", "is", null),
      access.organizationScope,
    );

    const [vendorsResult, profilesResult] = await Promise.all([
      vendorQuery,
      profileQuery || Promise.resolve({ data: [], error: null }),
    ]);

    if (vendorsResult.error) throw vendorsResult.error;
    if (profilesResult.error) throw profilesResult.error;

    const enabledVendorIds = new Set(
      (profilesResult.data || [])
        .map((profile: any) => profile.vendor_id)
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    );

    const vendors = (vendorsResult.data || [])
      .filter((vendor: any) => !enabledVendorIds.has(vendor.id))
      .map((vendor: any) => ({
        id: vendor.id,
        vendor_name: vendor.vendor_name,
        pan: vendor.pan,
        gstin: vendor.gstin,
        status: vendor.status,
      }));

    return NextResponse.json({ vendors });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load eligible vendor options.", 500);
  }
}
