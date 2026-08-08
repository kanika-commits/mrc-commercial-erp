import { NextResponse } from "next/server";
import { adminClient, canReviewEmployeeAttendancePeriod, hasAttendanceApprovalPermission, requireAttendanceApprovalActor } from "../_shared";
import { loadDetail, loadVisiblePeriods, enrichPeriodRows } from "../approvals/route";

function groupStatus(periods: any[]) {
  const statuses = periods.map((period) => period.status);
  if (statuses.length > 0 && statuses.every((status) => status === "finalized")) return "Approved";
  if (statuses.some((status) => status === "reopened" || status === "draft")) return "Needs Attention";
  if (statuses.some((status) => status === "finalized") && statuses.some((status) => status !== "finalized")) return "Partially Approved";
  if (statuses.length > 0 && statuses.every((status) => ["submitted", "level_1_approved", "level_2_approved"].includes(status))) return "Pending Approval";
  return "Mixed Status";
}

function toGroups(rows: any[], auth: any) {
  const groups = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.organization_id}:${row.site_id}:${row.period_month}`;
    const group = groups.get(key) || { id: key, organization_id: row.organization_id, site_id: row.site_id, site_name: row.site_name, period_month: row.period_month, period_label: row.period_label, periods: [], total_employee_count: 0, company_count: 0 };
    group.periods.push({ period_id: row.id, company_id: row.company_id, company_name: row.company_name, employee_count: row.employee_count, status: row.status, status_label: row.status_label, current_approval_level: row.current_approval_level, current_level_label: row.current_level_label, can_approve: hasAttendanceApprovalPermission(auth, "approve") && canReviewEmployeeAttendancePeriod(auth, row), can_send_back: hasAttendanceApprovalPermission(auth, "reject") && canReviewEmployeeAttendancePeriod(auth, row) });
    group.total_employee_count += Number(row.employee_count || 0);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({ ...group, company_count: group.periods.length, status: groupStatus(group.periods), status_label: groupStatus(group.periods) }));
}

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const params = new URL(request.url).searchParams;
    const periodStatus = params.get("period_status") || "pending";
    const periods = await loadVisiblePeriods(admin, auth, periodStatus);
    const rows = await enrichPeriodRows(admin, periods);
    const groups = toGroups(rows, auth);
    const siteId = params.get("site_id");
    const month = params.get("period_month");
    const group = groups.find((item) => (!siteId || item.site_id === siteId) && (!month || item.period_month === month));
    if (siteId || month) {
      if (!group) return NextResponse.json({ error: "Attendance approval group was not found." }, { status: 404 });
      const details = await Promise.all(group.periods.map((period: any) => loadDetail(admin, auth, period.period_id)));
      const validDetails = details.filter((detail: any) => !detail.response).map((detail: any) => detail.detail);
      const first = validDetails[0];
      const mergedRows = validDetails.flatMap((detail: any) => detail.rows.map((row: any) => ({ ...row, period_id: detail.period.id, company_id: detail.period.company_id, company_name: detail.company_name }))); 
      return NextResponse.json({ ...group, periods: group.periods, dates: first?.dates || [], rows: mergedRows, employees: mergedRows.map((row: any) => ({ ...row.employee, company_id: row.company_id, company_name: row.company_name })), history: validDetails.flatMap((detail: any) => detail.history || []), policy_snapshot: first?.policy_snapshot || {} });
    }
    return NextResponse.json({ groups, count: groups.length });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load grouped attendance approvals." }, { status: 500 }); }
}
