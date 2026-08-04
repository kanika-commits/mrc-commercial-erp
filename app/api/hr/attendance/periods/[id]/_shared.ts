import { jsonError } from "../../_shared";
import { applyOrganizationScope, isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import type { ServerPermissionContext } from "@/lib/serverPermissions";

export async function loadScopedPeriod(admin: any, auth: ServerPermissionContext, id: string) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin.from("employee_attendance_periods").select("*").eq("id", id);
  const scopedQuery = applyOrganizationScope(query, organizationScope);
  if (!scopedQuery) return { response: jsonError("Attendance period was not found.", 404) } as const;
  query = scopedQuery;

  const { data: period, error } = await query.maybeSingle();
  if (error) throw error;
  if (!period) return { response: jsonError("Attendance period was not found.", 404) } as const;

  if (!isGlobalScope(organizationScope)) {
    const { data: assignments, error: assignmentError } = await admin
      .from("user_access_assignments")
      .select("company_id, site_id")
      .eq("user_id", auth.user.id);
    if (assignmentError) throw assignmentError;
    const siteIds = new Set((assignments || []).map((row: any) => row.site_id).filter(Boolean));
    const companyIds = new Set((assignments || []).map((row: any) => row.company_id).filter(Boolean));
    if (siteIds.size > 0 && !siteIds.has(period.site_id)) {
      return { response: jsonError("Attendance period was not found.", 404) } as const;
    }
    if (siteIds.size === 0 && companyIds.size > 0 && !companyIds.has(period.company_id)) {
      return { response: jsonError("Attendance period was not found.", 404) } as const;
    }
  }

  return { period } as const;
}
