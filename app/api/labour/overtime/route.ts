import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, loadLabourEditLockBlocker, requireLabourPermission } from "@/app/api/labour/_shared";
import { isAllowed, LABOUR_OVERTIME_STATUSES, timeText } from "@/lib/labour/v2";
import { normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

const MAX_LABOUR_OT_MINUTES = 360;

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

export async function GET(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_overtime", "view");
    if ("response" in access) return access.response;
    let query = access.admin.from("labour_overtime_requests").select("*, labour_workers(labour_code, worker_name), labour_attendance(attendance_date, status)").order("created_at", { ascending: false });
    const scoped = applyOrganizationScope(query, access.organizationScope);
    if (!scoped) return NextResponse.json({ overtime_requests: [] });
    const { data, error } = await scoped;
    if (error) throw error;
    return NextResponse.json({ overtime_requests: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load overtime requests.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_overtime", "add");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const attendanceId = text(payload.attendance_id);
    if (!attendanceId) return jsonError("Attendance row is required for overtime.");
    const { data: attendance, error: attendanceError } = await access.admin.from("labour_attendance").select("*").eq("id", attendanceId).maybeSingle();
    if (attendanceError) throw attendanceError;
    if (!attendance) return jsonError("Attendance row not found.", 404);
    if (access.organizationScope !== null && !access.organizationScope.includes(attendance.organization_id)) return jsonError("Attendance row not found.", 404);
    const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId: attendance.organization_id, companyId: attendance.company_id, siteId: attendance.site_id, contractorProfileId: attendance.contractor_profile_id, attendanceDate: attendance.attendance_date });
    if (lockBlocker) return jsonError(lockBlocker, 403);
    if (!["present", "half_day"].includes(attendance.status)) return jsonError("Overtime requires present or half-day attendance.");
    const proposedStart = timeText(payload.proposed_start);
    const proposedEnd = timeText(payload.proposed_end);
    const proposedMinutes = Math.max(0, Number(payload.proposed_minutes || minutesBetween(proposedStart, proposedEnd)));
    if (!proposedMinutes) return jsonError("Proposed overtime minutes are required.");
    if (proposedMinutes > MAX_LABOUR_OT_MINUTES) return jsonError("OT Hours cannot exceed 6 hours.");
    const reason = text(payload.reason);
    if (!reason) return jsonError("Overtime reason is required.");
    const status = text(payload.status) || "draft";
    if (!isAllowed(LABOUR_OVERTIME_STATUSES, status)) return jsonError("Invalid overtime status.");
    const insertPayload = {
      organization_id: attendance.organization_id,
      company_id: attendance.company_id,
      site_id: attendance.site_id,
      attendance_id: attendance.id,
      labour_worker_id: attendance.labour_worker_id,
      work_group_id: text(payload.work_group_id),
      work_log_id: text(payload.work_log_id),
      proposed_start: proposedStart,
      proposed_end: proposedEnd,
      proposed_minutes: proposedMinutes,
      approved_minutes: status === "approved" ? proposedMinutes : null,
      reason,
      status,
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_overtime_requests").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, { moduleCode: "labour_overtime", action: "create", entityType: "labour_overtime_request", recordId: data.id, organizationId: attendance.organization_id, companyId: attendance.company_id, siteId: attendance.site_id, description: "Created labour overtime request.", newValues: insertPayload });
    return NextResponse.json({ overtime_request_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save overtime request.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_overtime", "approve");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const id = text(payload.id);
    const action = text(payload.action);
    if (!id) return jsonError("Overtime request is required.");
    const { data: overtime, error: loadError } = await access.admin.from("labour_overtime_requests").select("*").eq("id", id).maybeSingle();
    if (loadError) throw loadError;
    if (!overtime) return jsonError("Overtime request not found.", 404);
    if (access.organizationScope !== null && !access.organizationScope.includes(overtime.organization_id)) return jsonError("Overtime request not found.", 404);
    if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(overtime.company_id)) return jsonError("Overtime request not found.", 404);
    if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(overtime.site_id)) return jsonError("Overtime request not found.", 404);
    const { data: attendance, error: attendanceError } = await access.admin.from("labour_attendance").select("attendance_date, contractor_profile_id").eq("id", overtime.attendance_id).maybeSingle();
    if (attendanceError) throw attendanceError;
    if (attendance?.attendance_date) {
      const lockBlocker = await loadLabourEditLockBlocker(access, { organizationId: overtime.organization_id, companyId: overtime.company_id, siteId: overtime.site_id, contractorProfileId: attendance.contractor_profile_id, attendanceDate: attendance.attendance_date });
      if (lockBlocker) return jsonError(lockBlocker, 403);
    }
    const nextStatus = action === "submit" ? "submitted" : action === "verify" ? "verified" : action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
    if (!nextStatus) return jsonError("Invalid overtime action.");
    if (action === "approve") {
      const { data: policy, error: policyError } = await access.admin
        .from("labour_site_attendance_policies")
        .select("require_ot_start_photo, require_ot_end_photo, allow_self_approval")
        .eq("organization_id", overtime.organization_id)
        .eq("company_id", overtime.company_id)
        .eq("site_id", overtime.site_id)
        .eq("status", "active")
        .is("effective_to", null)
        .maybeSingle();
      if (policyError) throw policyError;
      if (policy && !policy.allow_self_approval && overtime.created_by === access.auth.user.id) {
        return jsonError("Self approval is not allowed for overtime at this site.", 403);
      }
      const requiredTypes = [
        policy?.require_ot_start_photo ? "overtime_start" : null,
        policy?.require_ot_end_photo ? "overtime_completion" : null,
      ].filter(Boolean);
      if (requiredTypes.length) {
        const { data: photos, error: photoError } = await access.admin
          .from("labour_photo_evidence")
          .select("photo_type")
          .eq("reference_type", "overtime")
          .eq("reference_id", id)
          .eq("is_active", true)
          .in("photo_type", requiredTypes);
        if (photoError) throw photoError;
        const present = new Set((photos || []).map((photo: any) => photo.photo_type));
        const missing = requiredTypes.filter((type) => !present.has(type));
        if (missing.length) return jsonError("Required overtime photos are missing before approval.", 403);
      }
    }
    const approvedMinutes = payload.approved_minutes === undefined || payload.approved_minutes === null || payload.approved_minutes === ""
      ? overtime.proposed_minutes
      : Math.max(0, Math.round(Number(payload.approved_minutes)));
    if (approvedMinutes > MAX_LABOUR_OT_MINUTES) return jsonError("OT Hours cannot exceed 6 hours.");
    const patch: Record<string, any> = {
      status: nextStatus,
      transition_reason: text(payload.reason),
      ...actorFields(access.auth, "updated"),
      updated_at: new Date().toISOString(),
    };
    if (action === "approve") {
      patch.approved_minutes = approvedMinutes;
      patch.approved_by = access.auth.user.id;
      patch.approved_by_name = access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
      patch.approved_by_email = access.auth.user.email || null;
      patch.approved_at = new Date().toISOString();
    }
    if (action === "verify") {
      patch.verified_by = access.auth.user.id;
      patch.verified_by_name = access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
      patch.verified_by_email = access.auth.user.email || null;
      patch.verified_at = new Date().toISOString();
    }
    const { error } = await access.admin.from("labour_overtime_requests").update(patch).eq("id", id);
    if (error) throw error;
    if (action === "approve") {
      await access.admin.from("labour_attendance").update({ approved_overtime_minutes: approvedMinutes, overtime_minutes: approvedMinutes }).eq("id", overtime.attendance_id);
    }
    await audit(access, request, { moduleCode: "labour_overtime", action: "update", entityType: "labour_overtime_request", recordId: id, organizationId: overtime.organization_id, companyId: overtime.company_id, siteId: overtime.site_id, description: `Updated overtime request to ${nextStatus}.`, oldValues: { status: overtime.status, approved_minutes: overtime.approved_minutes }, newValues: { status: nextStatus, approved_minutes: approvedMinutes, reason: text(payload.reason) } });
    return NextResponse.json({ updated: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update overtime request.", 500);
  }
}
