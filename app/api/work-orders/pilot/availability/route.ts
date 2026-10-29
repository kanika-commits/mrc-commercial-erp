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
    const companyId = text(params.get("company_id"));
    const siteId = text(params.get("site_id"));
    const workOrderType = canonicalType(params.get("wo_type"));
    if (!vendorId || !workOrderType) return NextResponse.json({ available: false, error: "Vendor and Work Order type are required." }, { status: 400 });
    if (workOrderType === "Daily Wage" && (!companyId || !siteId)) return NextResponse.json({ available: false, error: "Company and site are required to verify Daily Wage availability." }, { status: 400 });

    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const vendorQuery = applyOrganizationScope(admin.from("vendors").select("id,organization_id").eq("id", vendorId), scope);
    if (!vendorQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    const { data: vendor, error: vendorError } = await vendorQuery.maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || !isInOrganizationScope(scope, vendor.organization_id)) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    if (workOrderType !== "Daily Wage") return NextResponse.json({ available: true, normalized_type: workOrderType });

    const companyQuery = applyOrganizationScope(admin.from("companies").select("id,organization_id").eq("id", companyId), scope);
    const siteQuery = applyOrganizationScope(admin.from("sites").select("id,organization_id,company_id").eq("id", siteId), scope);
    if (!companyQuery || !siteQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
    const [{ data: company, error: companyError }, { data: site, error: siteError }] = await Promise.all([companyQuery.maybeSingle(), siteQuery.maybeSingle()]);
    if (companyError) throw companyError;
    if (siteError) throw siteError;
    if (!company || !site || company.organization_id !== vendor.organization_id || site.organization_id !== vendor.organization_id || site.company_id !== company.id) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });

    const { data: rows, error } = await admin.from("work_orders")
      .select("id,wo_number,wo_type,pilot_work_order_type,creation_request_id,status,approval_status,created_at")
      .eq("organization_id", vendor.organization_id)
      .eq("company_id", company.id)
      .eq("site_id", site.id)
      .eq("pilot_vendor_id", vendorId)
      .not("creation_request_id", "is", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const nonBlocking = new Set(["rejected", "cancelled", "canceled", "voided"]);
    const existing = (rows || []).find((row: any) => canonicalType(row.pilot_work_order_type || row.wo_type) === workOrderType && !nonBlocking.has(text(row.status).toLowerCase()) && !nonBlocking.has(text(row.approval_status).toLowerCase()));
    if (!existing) return NextResponse.json({ available: true, normalized_type: workOrderType });
    return NextResponse.json({ available: false, normalized_type: workOrderType, existing_work_order: { id: existing.id, wo_number: existing.wo_number, wo_type: workOrderType }, message: `This vendor already has a Daily Wage Work Order (${existing.wo_number || existing.id}). Create a revision of that Work Order instead.` });
  } catch {
    return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 500 });
  }
}
