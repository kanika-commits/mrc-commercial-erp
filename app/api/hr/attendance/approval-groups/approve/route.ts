import { NextResponse } from "next/server";
import { actorName } from "@/lib/hr/attendance";
import { insertErpAuditLog } from "@/lib/serverAudit";
import { adminClient, filterAccessibleDailySubmissions, hasAttendanceApprovalPermission, requireAttendanceApprovalActor } from "../../_shared";

export async function POST(request: Request) {
  try {
    const auth = await requireAttendanceApprovalActor(request);
    if ("response" in auth) return auth.response;
    if (!hasAttendanceApprovalPermission(auth, "approve")) return NextResponse.json({ error: "You do not have permission to approve attendance." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.daily_submission_ids) ? body.daily_submission_ids.map(String).filter(Boolean) : [];
    if (!ids.length) return NextResponse.json({ error: "Select at least one submitted daily attendance register." }, { status: 400 });
    const admin = adminClient();
    const result = await admin.from("employee_attendance_daily_submissions").select("*").in("id", ids).eq("status", "submitted");
    if (result.error) throw result.error;
    const states = await filterAccessibleDailySubmissions(admin, auth, result.data || []);
    const results = [];
    for (const state of states) {
      const now = new Date().toISOString();
      const updated = await admin.from("employee_attendance_daily_submissions").update({ status: "approved", approved_by: auth.user.id, approved_by_name: actorName(auth.user), approved_by_email: auth.user.email || null, approved_at: now, updated_by: auth.user.id, updated_by_name: actorName(auth.user), updated_by_email: auth.user.email || null, updated_at: now }).eq("id", state.id).eq("status", "submitted").select("*").single();
      if (updated.error) { results.push({ daily_submission_id: state.id, attendance_date: state.attendance_date, company_id: state.company_id, success: false, error: updated.error.message }); continue; }
      await insertErpAuditLog(admin, auth.user, { organizationId: state.organization_id, companyId: state.company_id, siteId: state.site_id, moduleCode: "hr_attendance_approval", entityType: "employee_attendance_daily_submission", recordId: state.id, action: "approve", description: "Daily employee attendance approved.", oldValues: state, newValues: updated.data, source: "system" }, request);
      results.push({ daily_submission_id: state.id, attendance_date: state.attendance_date, company_id: state.company_id, success: true, daily_submission: updated.data });
    }
    return NextResponse.json({ results });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to approve daily attendance." }, { status: 500 }); }
}
