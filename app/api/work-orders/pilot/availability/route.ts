import { NextResponse } from "next/server";
import { adminClient } from "@/app/api/approvals/_shared";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";

const TYPES = ["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"];
const text = (value: unknown) => String(value ?? "").trim();
const canonicalType = (value: unknown) => {
  const normalized = text(value).replace(/\s+/g, " ").toLowerCase();
  return TYPES.find((type) => type.toLowerCase() === normalized) || "";
};

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "add");
    if ("response" in auth) return auth.response;
    const params = new URL(request.url).searchParams;
    const vendorId = text(params.get("vendor_id"));
    const workOrderType = canonicalType(params.get("wo_type"));
    if (!vendorId || !workOrderType) return NextResponse.json({ available: false, error: "Vendor and Work Order type are required." }, { status: 400 });

    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const vendorQuery = applyOrganizationScope(
      admin.from("vendors").select("id,organization_id").eq("id", vendorId),
      scope,
    );
    if (!vendorQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    const { data: vendor, error: vendorError } = await vendorQuery.maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || !isInOrganizationScope(scope, vendor.organization_id)) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    if (workOrderType !== "Daily Wage") return NextResponse.json({ available: true, normalized_type: workOrderType });

    let query = admin
      .from("work_orders")
      .select("id,wo_number,wo_type,pilot_work_order_type,creation_request_id,status,approval_status,created_at")
      .eq("organization_id", vendor.organization_id)
      .eq("pilot_vendor_id", vendorId)
      .not("creation_request_id", "is", null)
      .order("created_at", { ascending: true });
    const { data: rows, error } = await query;
    if (error) throw error;
    const existing = (rows || []).find((row: any) => {
      const value = canonicalType(row.pilot_work_order_type || row.wo_type);
      const status = text(row.status).toLowerCase();
      const approvalStatus = text(row.approval_status).toLowerCase();
      const nonBlocking = new Set(["rejected", "cancelled", "canceled", "voided"]);
      return value === workOrderType && !nonBlocking.has(status) && !nonBlocking.has(approvalStatus);
    });
    if (!existing) return NextResponse.json({ available: true, normalized_type: workOrderType });
    return NextResponse.json({
      available: false,
      normalized_type: workOrderType,
      existing_work_order: { id: existing.id, wo_number: existing.wo_number, wo_type: workOrderType },
      message: `This vendor already has a Daily Wage Work Order (${existing.wo_number || existing.id}). Create a revision of that Work Order instead.`,
    });
  } catch (error: any) {
    return NextResponse.json({ available: false, error: error.message || "Availability could not be verified." }, { status: 500 });
  }
}
