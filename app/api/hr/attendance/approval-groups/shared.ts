import { applyOrganizationScope, isGlobalScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { loadActorAssignments } from "../_shared";

export async function accessibleDailyRows(admin: any, auth: any, statuses: string[]) {
  const organizationScope = await loadActorOrganizationScope(admin, auth);
  let query = admin
    .from("employee_attendance_daily_submissions")
    .select("*, companies(company_name, company_code), sites(site_name, site_code)")
    .in("status", statuses)
    .order("attendance_date", { ascending: false })
    .order("submitted_at", { ascending: true, nullsFirst: false });
  query = applyOrganizationScope(query, organizationScope);
  if (!query) return [];
  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (!isGlobalScope(organizationScope)) {
    const assignments = await loadActorAssignments(admin, auth.user.id);
    const explicitSiteIds = new Set(assignments.rows.map((assignment: any) => assignment.site_id).filter(Boolean));
    rows = rows.filter((row: any) => explicitSiteIds.size
      ? explicitSiteIds.has(row.site_id)
      : assignments.rows.some((assignment: any) =>
        (!assignment.organization_id || assignment.organization_id === row.organization_id) &&
        (!assignment.company_id || assignment.company_id === row.company_id) &&
        (!assignment.site_id || assignment.site_id === row.site_id),
      ));
  }
  return rows;
}
