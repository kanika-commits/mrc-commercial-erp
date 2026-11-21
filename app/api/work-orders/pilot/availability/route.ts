import { NextResponse } from "next/server";
import { adminClient } from "@/app/api/approvals/_shared";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";

const TYPES = ["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"];
type WorkOrderLike = {
  id?: string;
  wo_number?: string | null;
  status?: string | null;
  approval_status?: string | null;
  pilot_work_order_type?: string | null;
  wo_type?: string | null;
};
const text = (value: unknown) => String(value ?? "").trim();
const canonicalType = (value: unknown) => {
  const normalized = text(value).replace(/\s+/g, " ").toLowerCase();
  return TYPES.find((type) => type.toLowerCase() === normalized) || "";
};
const isLiveWorkOrder = (row: WorkOrderLike) => !["rejected", "cancelled", "canceled", "voided"].includes(text(row?.status).toLowerCase())
  && !["rejected", "cancelled", "canceled", "voided"].includes(text(row?.approval_status).toLowerCase());

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
    const draftId = text(params.get("draft_id"));
    if (!vendorId || !workOrderType) return NextResponse.json({ available: false, error: "Vendor and Work Order type are required." }, { status: 400 });
    if (workOrderType === "Daily Wage" && (!companyId || !siteId)) return NextResponse.json({ available: false, error: "Company and site are required to verify Daily Wage availability." }, { status: 400 });

    stage = "control_plane_client";
    const admin = adminClient();
    stage = "organization_scope";
    const scope = auth.isGlobalAccess ? null : auth.organizations;
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
    const companyAllowed = auth.isGlobalAccess || auth.companies.length === 0 || auth.companies.includes(company.id);
    const siteAllowed = auth.isGlobalAccess || auth.sites.length === 0 || auth.sites.includes(site.id);
    if (!company || !site || company.organization_id !== vendor.organization_id || site.organization_id !== vendor.organization_id || (site.company_id !== null && site.company_id !== company.id) || !companyAllowed || !siteAllowed) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });

    let editableDraftId = "";
    if (draftId) {
      const draftQuery = applyOrganizationScope(
        admin.from("work_orders").select("id,organization_id,company_id,site_id,pilot_vendor_id,pilot_work_order_type,wo_type,approval_status,creation_request_id,status").eq("id", draftId),
        scope,
      );
      if (!draftQuery) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
      const { data: draft, error: draftError } = await draftQuery.maybeSingle();
      if (draftError) throw draftError;
      const draftType = canonicalType(draft?.pilot_work_order_type || draft?.wo_type);
      if (!draft || !isInOrganizationScope(scope, draft.organization_id) || draft.approval_status !== "draft" || !draft.creation_request_id || draft.organization_id !== company.organization_id || draft.company_id !== company.id || draft.site_id !== site.id || draft.pilot_vendor_id !== vendor.id || draftType !== workOrderType || !isLiveWorkOrder(draft)) return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 403 });
      editableDraftId = draft.id;
    }

    stage = "work_order_validation_rpc";
    const { data: duplicate, error: duplicateError } = await admin.rpc("validate_work_order_pilot_creation", {
      p_organization_id: company.organization_id,
      p_vendor_id: vendor.id,
      p_work_order_type: workOrderType,
    });
    if (duplicateError) throw duplicateError;
    if (!editableDraftId && !duplicate?.existing_work_order_id) return NextResponse.json({ available: true, normalized_type: workOrderType });

    const { data: candidates, error: candidatesError } = await admin
      .from("work_orders")
      .select("id,wo_number,approval_status,status,pilot_vendor_id,pilot_work_order_type,wo_type,creation_request_id")
      .eq("organization_id", company.organization_id)
      .eq("pilot_vendor_id", vendor.id)
      .not("creation_request_id", "is", null);
    if (candidatesError) throw candidatesError;
    const conflict = (candidates || []).find((row: WorkOrderLike) => row.id !== editableDraftId && isLiveWorkOrder(row) && canonicalType(row.pilot_work_order_type || row.wo_type) === workOrderType);
    if (!conflict) return NextResponse.json({ available: true, normalized_type: workOrderType });
    return NextResponse.json({ available: false, normalized_type: workOrderType, existing_work_order: { id: conflict.id, wo_number: conflict.wo_number, wo_type: workOrderType }, message: `This vendor already has a Daily Wage Work Order (${conflict.wo_number || conflict.id}). Create a revision of that Work Order instead.` });
  } catch {
    console.error("work_order_pilot_availability_failed", { stage });
    return NextResponse.json({ available: false, error: "Availability could not be verified." }, { status: 500 });
  }
}
