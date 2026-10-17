import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/serverPermissions";
import { canAny, loadApprovalScope, adminClient, loadAllowedWorkOrderIds } from "@/app/api/approvals/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const PERMISSIONS = [
  { moduleCode: "wo_approval", actionCode: "view" },
  { moduleCode: "wo_approval", actionCode: "approve" },
];

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, PERMISSIONS);
    if ("response" in auth) return auth.response;
    if (!canAny(auth.permissions, "wo_approval", ["view", "approve"])) return NextResponse.json({ error: "You do not have permission to view Pilot revision approvals." }, { status: 403 });
    const admin = adminClient();
    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    let query = admin.from("work_order_pilot_revisions").select("id,work_order_id,revision_number,status,created_at,submitted_at,created_by,work_orders!inner(organization_id,creation_request_id,approval_status,wo_number,company_id,site_id,wo_date,wo_type,description,wo_value,gst_percent,companies(company_name),sites(site_name))").eq("status", "submitted").eq("work_orders.approval_status", "approved").not("work_orders.creation_request_id", "is", null).order("submitted_at", { ascending: false });
    query = applyOrganizationScope(query, organizationScope);
    if (!query) return NextResponse.json({ revisions: [] });
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(admin, organizationScope, assignments);
    if (allowedWorkOrderIds) query = query.in("work_order_id", allowedWorkOrderIds.length ? allowedWorkOrderIds : ["00000000-0000-0000-0000-000000000000"]);
    const result = await query;
    if (result.error) throw result.error;
    const revisions = result.data || [];
    const submitterIds = revisions.map((revision: any) => revision.created_by).filter(Boolean);
    const profiles = submitterIds.length
      ? await admin.from("profiles").select("id,full_name,email").in("id", submitterIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const profileById = new Map((profiles.data || []).map((profile: any) => [profile.id, profile]));
    return NextResponse.json({ revisions: revisions.map((revision: any) => ({ ...revision, submitter: profileById.get(revision.created_by) || null })) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load Pilot revision approvals." }, { status: 500 });
  }
}
