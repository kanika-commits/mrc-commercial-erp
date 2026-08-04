import { NextResponse } from "next/server";
import { applyCompanySiteScope, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_manpower_work_orders", "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    let query = access.admin
      .from("manpower_work_orders")
      .select(`
        *,
        companies(company_name, company_code),
        sites(site_name, site_code),
        labour_contractor_profiles(id, contractor_code, vendors(vendor_name, pan, gstin)),
        work_orders(id, wo_number),
        manpower_work_order_rates(*, labour_trades(trade_name, trade_code)),
        labour_deployments(id, labour_worker_id, status, effective_from, effective_to, labour_workers(labour_code, worker_name, father_or_husband_name))
      `)
      .eq("id", id);
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return jsonError("Manpower Work Order not found.", 404);
    query = applyCompanySiteScope(scoped, access.assignments);
    if (!query) return jsonError("Manpower Work Order not found.", 404);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return jsonError("Manpower Work Order not found.", 404);
    return NextResponse.json({ manpower_work_order: data });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Manpower Work Order.", 500);
  }
}
