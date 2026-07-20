import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  adminClient,
  applyWorkOrderScope,
  canAny,
  loadAllowedWorkOrderIds,
  loadApprovalScope,
  safeQuery,
} from "@/app/api/approvals/_shared";

const APPROVAL_PERMISSIONS = [
  { moduleCode: "ra_approval", actionCode: "view" },
  { moduleCode: "ra_approval", actionCode: "approve" },
  { moduleCode: "ra_approval", actionCode: "reject" },
];

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, APPROVAL_PERMISSIONS);
    if ("response" in auth) return auth.response;

    const admin = adminClient();
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(
      admin,
      organizationScope,
      assignments,
    );

    const canLoadApprovals = canAny(auth.permissions, "ra_approval", [
      "view",
      "approve",
      "reject",
    ]);
    const raQuery = canLoadApprovals
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("ra_bills")
              .select(
                `
                  id,
                  organization_id,
                  work_order_id,
                  vendor_id,
                  ra_number,
                  ra_date,
                  gross_amount,
                  net_amount,
                  status,
                  approval_status,
                  created_at,
                  created_by_name,
                  created_by_email,
                  gst_amount
                `,
              )
              .ilike("approval_status", "pending")
              .order("created_at", { ascending: false }),
            organizationScope,
          ),
          allowedWorkOrderIds,
        )
      : null;

    const debitQuery = canLoadApprovals
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("debit_notes")
              .select(
                `
                  id,
                  organization_id,
                  work_order_id,
                  vendor_id,
                  debit_note_number,
                  debit_note_date,
                  debit_note_type,
                  reason,
                  gross_amount,
                  total_amount,
                  status,
                  approval_status,
                  created_at,
                  created_by_name,
                  created_by_email
                `,
              )
              .ilike("approval_status", "pending")
              .order("created_at", { ascending: false }),
            organizationScope,
          ),
          allowedWorkOrderIds,
        )
      : null;

    const [raBills, debitNotes] = await Promise.all([
      safeQuery(raQuery),
      safeQuery(debitQuery),
    ]);

    const workOrderIds = Array.from(
      new Set(
        [
          ...raBills.map((bill: any) => bill.work_order_id),
          ...debitNotes.map((note: any) => note.work_order_id),
        ].filter(Boolean),
      ),
    );
    const vendorIds = Array.from(
      new Set(
        [
          ...raBills.map((bill: any) => bill.vendor_id),
          ...debitNotes.map((note: any) => note.vendor_id),
        ].filter(Boolean),
      ),
    );
    const workOrders = await safeQuery(
      workOrderIds.length
        ? admin
            .from("work_orders")
            .select("id, wo_number, company_id, site_id")
            .in("id", workOrderIds)
        : null,
    );
    const siteIds = Array.from(
      new Set(
        [
          ...workOrders.map((wo: any) => wo.site_id),
        ].filter(Boolean),
      ),
    );
    const companyIds = Array.from(
      new Set(
        [
          ...workOrders.map((wo: any) => wo.company_id),
        ].filter(Boolean),
      ),
    );

    const [vendors, sites, companies] = await Promise.all([
      safeQuery(
        vendorIds.length
          ? admin.from("vendors").select("id, vendor_name").in("id", vendorIds)
          : null,
      ),
      safeQuery(
        siteIds.length
          ? admin.from("sites").select("id, site_name, site_code").in("id", siteIds)
          : null,
      ),
      safeQuery(
        companyIds.length
          ? admin
              .from("companies")
              .select("id, company_name, company_code")
              .in("id", companyIds)
          : null,
      ),
    ]);

    return NextResponse.json({
      bills: raBills,
      debitNotes,
      workOrders,
      vendors,
      sites,
      companies,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load approvals." },
      { status: 500 },
    );
  }
}
