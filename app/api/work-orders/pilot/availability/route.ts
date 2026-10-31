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
  let stage = "authorization";
  try {
    const auth = await requirePermission(request, "work_orders", "add");
    if ("response" in auth) return auth.response;
    stage = "request_validation";
    const params = new URL(request.url).searchParams;
    const vendorId = text(params.get("vendor_id"));
    const companyId = text(params.get("company_id"));
    const siteId = text(params.get("site_id"));
    const workOrderType = canonicalType(params.get("wo_type"));
    if (!vendorId || !workOrderType) return NextResponse.json({ available: false, error: "Vendor and Work Order type are required." }, { status: 400 });
    if (workOrderType === "Daily Wage" && (!companyId || !siteId)) return NextResponse.json({ available: false, error: "Company and site are required to verify Daily Wage availability." }, { status: 400 });

    stage = "control_plane_client";
    const admin = adminClient();
    stage = "organization_scope";
    const scope = await loadActorOrganizationScope(admin, auth);
    stage = "vendor_query";
    const vendorQuery = applyOrganizationScope(admin.from("vendors").select("id,organization_id").eq("id", vendorId), scope);
    if (!vendorQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    const { data: vendor, error: vendorError } = await vendorQuery.maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || !isInOrganizationScope(scope, vendor.organization_id)) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    if (workOrderType !== "Daily Wage") return NextResponse.json({ available: true, normalized_type: workOrderType });

    stage = "company_site_query";
    const companyQuery = applyOrganizationScope(admin.from("companies").select("id,organization_id").eq("id", companyId), scope);
    const siteQuery = applyOrganizationScope(admin.from("sites").select("id,organization_id,company_id").eq("id", siteId), scope);
    if (!companyQuery || !siteQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([companyQuery.maybeSingle(), siteQuery.maybeSingle()]);
    if (companyError) throw companyError;
    if (siteError) throw siteError;
    if (!company || !site || company.organization_id !== vendor.organization_id || site.organization_id !== vendor.organization_id || site.company_id !== company.id) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });

    stage = "work_order_validation_rpc";
    const { data: duplicate, error: duplicateError } = await admin.rpc("validate_work_order_pilot_creation", {
      p_organization_id: company.organization_id,
      p_company_id: company.id,
      p_site_id: site.id,
      p_vendor_id: vendor.id,
      p_work_order_type: workOrderType,
    });
    if (duplicateError) throw duplicateError;
    if (!duplicate?.existing_work_order_id) return NextResponse.json({ available: true, normalized_type: workOrderType });
    return NextResponse.json({
      available: false,
      normalized_type: workOrderType,
      existing_work_order: { id: duplicate.existing_work_order_id, wo_number: duplicate.existing_wo_number, wo_type: workOrderType },
      message: `This vendor already has a Daily Wage Work Order (${duplicate.existing_wo_number || duplicate.existing_work_order_id}). Create a revision of that Work Order instead.`,
    });
  } catch {
    console.error("work_order_pilot_availability_failed", { stage });
    return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 500 });
  }
}
