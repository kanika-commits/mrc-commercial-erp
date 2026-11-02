import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient } from "@/lib/serverProcurementAccess";
import { applyOrganizationScope, isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";

export async function loadAuthorizedWorkOrderDraft(request: Request, id: string) {
  const auth = await requirePermission(request, "work_orders", "edit");
  if ("response" in auth) return { response: auth.response } as const;
  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  let query: any = admin.from("work_orders").select("*").eq("id", id).eq("approval_status", "draft").not("creation_request_id", "is", null);
  query = applyOrganizationScope(query, scope);
  if (!query) return { response: NextResponse.json({ error: "Work Order draft was not found." }, { status: 404 }) } as const;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || !isInOrganizationScope(scope, data.organization_id)) return { response: NextResponse.json({ error: "Work Order draft was not found." }, { status: 404 }) } as const;
  let assignmentsQuery: any = admin.from("user_access_assignments").select("organization_id,company_id,site_id").eq("user_id", auth.user.id);
  if (scope !== null) assignmentsQuery = assignmentsQuery.in("organization_id", scope);
  const assignments = await assignmentsQuery;
  if (assignments.error) throw assignments.error;
  const siteIds = new Set((assignments.data || []).map((row: any) => row.site_id).filter(Boolean));
  const companyIds = new Set((assignments.data || []).map((row: any) => row.company_id).filter(Boolean));
  const inCompanySiteScope = scope === null || (siteIds.size > 0 ? siteIds.has(data.site_id) : companyIds.size > 0 && companyIds.has(data.company_id));
  if (!inCompanySiteScope) return { response: NextResponse.json({ error: "You do not have access to this Work Order draft." }, { status: 403 }) } as const;
  return { auth, admin, data, scope } as const;
}
