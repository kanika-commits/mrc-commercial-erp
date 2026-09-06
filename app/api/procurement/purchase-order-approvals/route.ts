import { NextResponse } from "next/server";
import { requireProcurementAny, adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_purchase_orders";

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementAny(request, [
      { moduleCode: MODULE, actionCode: "view" },
      { moduleCode: MODULE, actionCode: "approve" },
    ]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(
      admin.from("procurement_purchase_orders").select("id,organization_id,company_id,site_id,po_number,po_date,status,total_amount,created_by_name,created_by_email,submitted_at,vendor_name_snapshot,company:companies(id,company_name),site:sites(id,site_name)").eq("status", "pending_approval").order("submitted_at", { ascending: false }),
      auth,
    );
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return NextResponse.json({ purchase_orders: [] });
    const { data, error } = await query;
    if (error) throw error;
    const purchaseOrders = data || [];
    const ids = purchaseOrders.map((row: any) => row.id).filter(Boolean);
    const { data: events, error: eventError } = ids.length
      ? await admin.from("procurement_purchase_order_events").select("purchase_order_id,event_type,actor_name,actor_email,created_at").in("purchase_order_id", ids).in("event_type", ["submit", "submitted_for_approval", "resubmitted"]).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (eventError) throw eventError;
    const latestSubmission = new Map<string, any>();
    for (const event of events || []) if (!latestSubmission.has(event.purchase_order_id)) latestSubmission.set(event.purchase_order_id, event);
    return NextResponse.json({ purchase_orders: purchaseOrders.map((row: any) => ({ ...row, submission_event: latestSubmission.get(row.id) || null })) });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Purchase Order approvals.", 500);
  }
}
