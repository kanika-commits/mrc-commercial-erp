import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  adminClient,
  applyCompanySiteScope,
  applyWorkOrderScope,
  canAny,
  loadAllowedWorkOrderIds,
  loadApprovalScope,
  safeQuery,
} from "@/app/api/approvals/_shared";

const APPROVAL_PERMISSIONS = [
  { moduleCode: "ra_bills", actionCode: "view" },
  { moduleCode: "ra_bills", actionCode: "approve" },
  { moduleCode: "ra_bills", actionCode: "reject" },
  { moduleCode: "debit_notes", actionCode: "view" },
  { moduleCode: "debit_notes", actionCode: "approve" },
  { moduleCode: "debit_notes", actionCode: "delete" },
  { moduleCode: "reimbursements", actionCode: "view" },
  { moduleCode: "reimbursements", actionCode: "approve" },
  { moduleCode: "reimbursements", actionCode: "reject" },
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

    const canLoadRaBills = canAny(auth.permissions, "ra_bills", [
      "view",
      "approve",
      "reject",
    ]);
    const canLoadDebitNotes = canAny(auth.permissions, "debit_notes", [
      "view",
      "approve",
      "delete",
    ]);
    const canLoadReimbursements = canAny(auth.permissions, "reimbursements", [
      "view",
      "approve",
      "reject",
    ]);

    const raQuery = canLoadRaBills
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

    const debitQuery = canLoadDebitNotes
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

    let reimbursementQuery = canLoadReimbursements
      ? applyOrganizationScope(
          admin
            .from("reimbursement_claims")
            .select(
              "id, organization_id, company_id, site_id, employee_id, claim_number, claim_date, claim_type, claim_for, amount, gst_amount, total_amount, status, created_at, created_by_name, created_by_email",
            )
            .eq("status", "pending")
            .order("created_at", { ascending: false }),
          organizationScope,
        )
      : null;

    if (reimbursementQuery) {
      reimbursementQuery = applyCompanySiteScope(reimbursementQuery, assignments);
    }

    const [raBills, debitNotes, reimbursements] = await Promise.all([
      safeQuery(raQuery),
      safeQuery(debitQuery),
      safeQuery(reimbursementQuery),
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
    const employeeIds = Array.from(
      new Set(reimbursements.map((claim: any) => claim.employee_id).filter(Boolean)),
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
          ...reimbursements.map((claim: any) => claim.site_id),
        ].filter(Boolean),
      ),
    );
    const companyIds = Array.from(
      new Set(
        [
          ...workOrders.map((wo: any) => wo.company_id),
          ...reimbursements.map((claim: any) => claim.company_id),
        ].filter(Boolean),
      ),
    );

    const [vendors, sites, companies, hrEmployees] = await Promise.all([
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
      safeQuery(
        employeeIds.length
          ? admin
              .from("hr_employees")
              .select("id, employee_name, employee_code")
              .in("id", employeeIds)
          : null,
      ),
    ]);

    return NextResponse.json({
      bills: raBills,
      debitNotes,
      reimbursements,
      workOrders,
      vendors,
      sites,
      companies,
      hrEmployees,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load approvals." },
      { status: 500 },
    );
  }
}
