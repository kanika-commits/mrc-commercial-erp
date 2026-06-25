import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission, type ServerPermission } from "@/lib/serverPermissions";
import {
  applyOrganizationScope,
  isGlobalScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";

const COUNT_PERMISSIONS = [
  { moduleCode: "dashboard", actionCode: "view" },
  { moduleCode: "work_orders", actionCode: "view" },
  { moduleCode: "wo_approval", actionCode: "view" },
  { moduleCode: "wo_approval", actionCode: "approve" },
  { moduleCode: "ra_bills", actionCode: "view" },
  { moduleCode: "ra_approval", actionCode: "view" },
  { moduleCode: "ra_approval", actionCode: "approve" },
  { moduleCode: "ra_approval", actionCode: "reject" },
  { moduleCode: "debit_notes", actionCode: "view" },
  { moduleCode: "invoices", actionCode: "view" },
  { moduleCode: "itc_claims", actionCode: "view" },
  { moduleCode: "itc_claims", actionCode: "approve" },
  { moduleCode: "vendors", actionCode: "view" },
];

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function canAny(
  permissions: ServerPermission[],
  moduleCode: string,
  actionCodes: string[]
) {
  return permissions.some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === moduleCode &&
          actionCodes.includes(permission.action_code)))
  );
}

async function loadActorAccessAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("organization_id, company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean))
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean))
    ) as string[],
  };
}

async function loadAllowedWorkOrderIds(
  admin: ReturnType<typeof adminClient>,
  organizationScope: string[] | null,
  companyIds: string[],
  siteIds: string[]
) {
  let query = admin.from("work_orders").select("id");

  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return [];
  query = scopedQuery;

  if (siteIds.length > 0) {
    query = query.in("site_id", siteIds);
  } else if (companyIds.length > 0) {
    query = query.in("company_id", companyIds);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data || []).map((workOrder) => workOrder.id).filter(Boolean) as string[];
}

function applyWorkOrderScope(query: any, workOrderIds: string[] | null, column = "work_order_id") {
  if (workOrderIds === null) return query;
  if (workOrderIds.length === 0) return null;
  return query.in(column, workOrderIds);
}

async function runCount(query: any) {
  if (!query) return 0;
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, COUNT_PERMISSIONS);

    if ("response" in auth) {
      return auth.response;
    }

    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const assignments = isGlobalScope(organizationScope)
      ? { companyIds: [], siteIds: [] }
      : await loadActorAccessAssignments(admin, auth.user.id);
    const allowedWorkOrderIds = isGlobalScope(organizationScope)
      ? null
      : await loadAllowedWorkOrderIds(
          admin,
          organizationScope,
          assignments.companyIds,
          assignments.siteIds
        );

    const canWorkOrders =
      canAny(auth.permissions, "work_orders", ["view"]) ||
      canAny(auth.permissions, "wo_approval", ["view", "approve"]);
    const canCommercialApprovals = canAny(auth.permissions, "ra_approval", [
      "view",
      "approve",
      "reject",
    ]);
    const canRaBills =
      canAny(auth.permissions, "ra_bills", ["view"]) || canCommercialApprovals;
    const canDebitNotes =
      canAny(auth.permissions, "debit_notes", ["view"]) || canCommercialApprovals;
    const canInvoices =
      canAny(auth.permissions, "invoices", ["view"]) ||
      canAny(auth.permissions, "itc_claims", ["view", "approve"]);
    const canVendors = canAny(auth.permissions, "vendors", ["view"]);

    const pendingWorkOrdersQuery = canWorkOrders
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("work_orders")
              .select("id", { count: "exact", head: true })
              .ilike("approval_status", "pending"),
            organizationScope
          ),
          allowedWorkOrderIds,
          "id"
        )
      : null;
    const pendingRaBillsQuery = canRaBills
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("ra_bills")
              .select("id", { count: "exact", head: true })
              .ilike("approval_status", "pending"),
            organizationScope
          ),
          allowedWorkOrderIds
        )
      : null;
    const pendingDebitNotesQuery = canDebitNotes
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("debit_notes")
              .select("id", { count: "exact", head: true })
              .ilike("approval_status", "pending"),
            organizationScope
          ),
          allowedWorkOrderIds
        )
      : null;
    const pendingItcQuery = canInvoices
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("invoices")
              .select("id", { count: "exact", head: true })
              .or("itc_status.is.null,itc_status.ilike.pending"),
            organizationScope
          ),
          allowedWorkOrderIds
        )
      : null;
    const pendingInvoiceApprovalsQuery = canInvoices
      ? applyWorkOrderScope(
          applyOrganizationScope(
            admin
              .from("invoices")
              .select("id", { count: "exact", head: true })
              .ilike("approval_status", "pending"),
            organizationScope
          ),
          allowedWorkOrderIds
        )
      : null;

    const vendorBaseQuery = canVendors
      ? applyOrganizationScope(
          admin
            .from("vendors")
            .select("id", { count: "exact", head: true })
            .neq("status", "deleted"),
          organizationScope
        )
      : null;
    const panAadhaarQuery = canVendors
      ? applyOrganizationScope(
          admin
            .from("vendors")
            .select("id", { count: "exact", head: true })
            .neq("status", "deleted")
            .neq("pan_aadhaar_link_status", "Yes"),
          organizationScope
        )
      : null;
    const blockedVendorsQuery = canVendors
      ? applyOrganizationScope(
          admin
            .from("vendors")
            .select("id", { count: "exact", head: true })
            .eq("status", "blocked"),
          organizationScope
        )
      : null;
    const inactiveVendorsQuery = canVendors
      ? applyOrganizationScope(
          admin
            .from("vendors")
            .select("id", { count: "exact", head: true })
            .eq("status", "inactive"),
          organizationScope
        )
      : null;

    const [
      pendingWorkOrders,
      pendingRaBills,
      pendingDebitNotes,
      pendingItcReview,
      pendingInvoiceApprovals,
      totalVendors,
      panAadhaarPending,
      blockedVendors,
      inactiveVendors,
    ] = await Promise.all([
      runCount(pendingWorkOrdersQuery),
      runCount(pendingRaBillsQuery),
      runCount(pendingDebitNotesQuery),
      runCount(pendingItcQuery),
      runCount(pendingInvoiceApprovalsQuery),
      runCount(vendorBaseQuery),
      runCount(panAadhaarQuery),
      runCount(blockedVendorsQuery),
      runCount(inactiveVendorsQuery),
    ]);

    return NextResponse.json({
      pendingWorkOrders,
      pendingRaBills,
      pendingDebitNotes,
      pendingItcReview,
      pendingInvoiceApprovals,
      totalVendors,
      panAadhaarPending,
      blockedVendors,
      inactiveVendors,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load notification counts." },
      { status: 500 }
    );
  }
}
