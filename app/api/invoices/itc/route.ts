import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import {
  adminClient,
  applyWorkOrderScope,
  canAny,
  loadAllowedWorkOrderIds,
  loadApprovalScope,
  safeQuery,
} from "@/app/api/approvals/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const ITC_REVIEW_PERMISSIONS = [
  { moduleCode: "itc_claims", actionCode: "view" },
  { moduleCode: "itc_claims", actionCode: "approve" },
];

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, ITC_REVIEW_PERMISSIONS);
    if ("response" in auth) return auth.response;

    if (!canAny(auth.permissions, "itc_claims", ["view", "approve"])) {
      return NextResponse.json(
        { error: "You do not have permission to view ITC review." },
        { status: 403 },
      );
    }

    const admin = adminClient();
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(
      admin,
      organizationScope,
      assignments,
    );

    let query = applyWorkOrderScope(
      applyOrganizationScope(
        admin
          .from("invoices")
          .select(
            `
              id,
              organization_id,
              work_order_id,
              vendor_id,
              invoice_number,
              invoice_date,
              taxable_amount,
              gst_rate,
              gst_amount,
              invoice_amount,
              itc_status,
              remarks,
              created_at
            `,
          )
          .or("itc_status.is.null,itc_status.ilike.pending")
          .order("invoice_date", { ascending: false }),
        organizationScope,
      ),
      allowedWorkOrderIds,
    );

    const invoices = await safeQuery(query);
    const workOrderIds = Array.from(
      new Set(invoices.map((invoice: any) => invoice.work_order_id).filter(Boolean)),
    );
    const vendorIds = Array.from(
      new Set(invoices.map((invoice: any) => invoice.vendor_id).filter(Boolean)),
    );

    const [workOrders, vendors] = await Promise.all([
      safeQuery(
        workOrderIds.length
          ? admin.from("work_orders").select("id, wo_number").in("id", workOrderIds)
          : null,
      ),
      safeQuery(
        vendorIds.length
          ? admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
          : null,
      ),
    ]);

    return NextResponse.json({ invoices, workOrders, vendors });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load ITC review." },
      { status: 500 },
    );
  }
}
