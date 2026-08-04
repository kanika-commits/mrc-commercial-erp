import { NextResponse } from "next/server";
import { applyCompanySiteScope, jsonError, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const batchId = new URL(request.url).searchParams.get("batch_id");
    if (!batchId) return jsonError("Batch ID is required.");
    const batch = await loadScopedLabourImportBatch(access, batchId);
    if (!batch) return jsonError("Import batch not found.", 404);
    const scopedWorkOrdersQuery = applyCompanySiteScope(
      access.admin
        .from("work_orders")
        .select("id, organization_id, company_id, site_id, wo_number, wo_type, status, approval_status")
        .eq("organization_id", batch.organization_id)
        .eq("status", "active"),
      access.assignments,
    );
    const [
      { data: rows, error: rowsError },
      { data: companies, error: companiesError },
      { data: sites, error: sitesError },
      { data: trades, error: tradesError },
      { data: contractors, error: contractorsError },
      { data: vendors, error: vendorsError },
      workOrdersResult,
      { data: workOrderLinks, error: workOrderLinksError },
    ] = await Promise.all([
      access.admin.from("labour_import_rows").select("*").eq("batch_id", batchId).order("source_row_number"),
      access.admin.from("companies").select("id, company_name, company_code").eq("organization_id", batch.organization_id).order("company_name"),
      access.admin.from("sites").select("id, site_name, site_code").eq("organization_id", batch.organization_id).order("site_name"),
      access.admin.from("labour_trades").select("id, trade_name, trade_code").eq("organization_id", batch.organization_id).eq("status", "active").order("trade_name"),
      access.admin
        .from("labour_contractor_profiles")
        .select("id, vendor_id, contractor_code, vendors(id, vendor_name, status)")
        .eq("organization_id", batch.organization_id)
        .eq("contractor_status", "active")
        .order("contractor_code"),
      access.admin.from("vendors").select("id, vendor_name, contractor_type, status").eq("organization_id", batch.organization_id).eq("status", "active").order("vendor_name"),
      scopedWorkOrdersQuery ? scopedWorkOrdersQuery.order("wo_number") : Promise.resolve({ data: [], error: null }),
      access.admin.from("work_order_vendors").select("work_order_id, vendor_id"),
    ]);
    const { data: workOrders, error: workOrdersError } = workOrdersResult;
    if (rowsError) throw rowsError;
    if (companiesError) throw companiesError;
    if (sitesError) throw sitesError;
    if (tradesError) throw tradesError;
    if (contractorsError) throw contractorsError;
    if (vendorsError) throw vendorsError;
    if (workOrdersError) throw workOrdersError;
    if (workOrderLinksError) throw workOrderLinksError;
    const contractorOptions = new Map<string, any>();
    for (const contractor of contractors || []) {
      const vendor = Array.isArray(contractor.vendors) ? contractor.vendors[0] : contractor.vendors;
      if (!vendor?.id || vendor.status !== "active") continue;
      if (!contractorOptions.has(vendor.id)) {
        contractorOptions.set(vendor.id, {
          id: vendor.id,
          name: vendor.vendor_name,
          code: contractor.contractor_code || "",
          profile_id: contractor.id,
        });
      }
    }
    for (const vendor of vendors || []) {
      if (!vendor?.id || contractorOptions.has(vendor.id)) continue;
      contractorOptions.set(vendor.id, {
        id: vendor.id,
        name: vendor.vendor_name,
        code: vendor.contractor_type || "",
        profile_id: null,
      });
    }
    const linksByWorkOrderId = new Map<string, Set<string>>();
    for (const link of workOrderLinks || []) {
      if (!link.work_order_id || !link.vendor_id) continue;
      const vendorIds = linksByWorkOrderId.get(link.work_order_id) || new Set<string>();
      vendorIds.add(link.vendor_id);
      linksByWorkOrderId.set(link.work_order_id, vendorIds);
    }
    const workOrderOptions = [];
    for (const workOrder of workOrders || []) {
      const vendorIds = linksByWorkOrderId.get(workOrder.id);
      if (!vendorIds?.size) continue;
      for (const vendorId of vendorIds) {
        workOrderOptions.push({
          id: workOrder.id,
          vendor_id: vendorId,
          site_id: workOrder.site_id,
          wo_number: workOrder.wo_number || "",
          wo_type: workOrder.wo_type || "",
          commercial_model: workOrder.wo_type === "Daily Wage" ? "daily_wage" : "contract_basis",
          requires_daily_rate: workOrder.wo_type === "Daily Wage",
          label: `${workOrder.wo_number || "WO"} — ${workOrder.wo_type || "Work Order"}`,
        });
      }
    }
    return NextResponse.json({
      batch,
      rows: rows || [],
      master_options: {
        companies: (companies || []).map((item: any) => ({ id: item.id, name: item.company_name, code: item.company_code || "" })),
        sites: (sites || []).map((item: any) => ({ id: item.id, name: item.site_name, code: item.site_code || "" })),
        contractors: Array.from(contractorOptions.values()).sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || ""))),
        trades: (trades || []).map((item: any) => ({ id: item.id, name: item.trade_name, code: item.trade_code || "" })),
        work_orders: workOrderOptions,
      },
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour import preview.", 500);
  }
}
