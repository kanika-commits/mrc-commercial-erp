import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import { applyWorkOrderScope, loadAllowedWorkOrderIds, loadApprovalScope } from "@/app/api/approvals/_shared";

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "approve");
    if ("response" in auth) return auth.response;
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(admin, organizationScope, assignments);
    let query = admin.from("work_order_pilot_ra_bills").select("id,organization_id,work_order_id,bill_number,bill_date,status,created_by,created_at,submitted_at,calculation_snapshot,work_order_snapshot,work_order:work_orders!inner(organization_id,creation_request_id,approval_status,wo_number,site_id,company_id,companies(company_name),sites(site_name),work_order_vendors(vendor_id,is_primary,vendors(vendor_name)))").eq("status", "submitted").eq("work_order.approval_status", "approved").not("work_order.creation_request_id", "is", null).order("submitted_at", { ascending: false });
    query = applyOrganizationScope(query, organizationScope);
    query = applyWorkOrderScope(query, allowedWorkOrderIds);
    if (!query) return NextResponse.json({ bills: [] });
    const { data, error } = await query;
    if (error) throw error;
    const ids = (data || []).map((bill: any) => bill.created_by).filter(Boolean);
    const profiles = ids.length ? await admin.from("profiles").select("id,full_name,email").in("id", ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const byId = new Map((profiles.data || []).map((profile: any) => [profile.id, profile]));
    return NextResponse.json({ bills: (data || []).map((bill: any) => {
      const vendorLink = (bill.work_order?.work_order_vendors || []).find((link: any) => link.is_primary) || bill.work_order?.work_order_vendors?.[0];
      return { ...bill, work_order_snapshot: { ...(bill.work_order_snapshot || {}), vendor_name: vendorLink?.vendors?.vendor_name || bill.work_order_snapshot?.vendor_name || null, company_name: null, company: null }, submitter: byId.get(bill.created_by) || null };
    }) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not load Pilot RA Bill approvals." }, { status: 500 });
  }
}
