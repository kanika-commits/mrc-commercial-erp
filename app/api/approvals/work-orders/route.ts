import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";
import {
  adminClient,
  applyCompanySiteScope,
  canAny,
  loadApprovalScope,
  safeQuery,
} from "@/app/api/approvals/_shared";

const WORK_ORDER_APPROVAL_PERMISSIONS = [
  { moduleCode: "wo_approval", actionCode: "view" },
  { moduleCode: "wo_approval", actionCode: "approve" },
];

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, WORK_ORDER_APPROVAL_PERMISSIONS);
    if ("response" in auth) return auth.response;

    if (!canAny(auth.permissions, "wo_approval", ["view", "approve"])) {
      return NextResponse.json(
        { error: "You do not have permission to view Work Order approvals." },
        { status: 403 },
      );
    }

    const admin = adminClient();
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    let query = applyOrganizationScope(
      admin
        .from("work_orders")
        .select(
          `
            id,
            organization_id,
            company_id,
            site_id,
            wo_number,
            wo_date,
            wo_type,
            description,
            status,
            wo_value,
            gst_percent,
            approval_status,
            department,
            cost_code,
            created_by_name,
            created_by_email,
            created_at,
            approved_at
          `,
        )
        .or("approval_status.is.null,approval_status.ilike.pending,approval_status.ilike.draft")
        .order("created_at", { ascending: false }),
      organizationScope,
    );

    if (!query) {
      return NextResponse.json({
        workOrders: [],
        companies: [],
        sites: [],
      });
    }

    query = applyCompanySiteScope(query, assignments);

    const workOrders = await safeQuery(query);
    const companyIds = Array.from(
      new Set(workOrders.map((wo: any) => wo.company_id).filter(Boolean)),
    );
    const siteIds = Array.from(
      new Set(workOrders.map((wo: any) => wo.site_id).filter(Boolean)),
    );

    const [companies, sites] = await Promise.all([
      safeQuery(
        companyIds.length
          ? admin.from("companies").select("id, company_name").in("id", companyIds)
          : null,
      ),
      safeQuery(
        siteIds.length
          ? admin.from("sites").select("id, site_name").in("id", siteIds)
          : null,
      ),
    ]);

    return NextResponse.json({ workOrders, companies, sites });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Work Order approvals." },
      { status: 500 },
    );
  }
}
