import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission, validateLabourCompanySiteIndependent } from "@/app/api/labour/_shared";
import { isoDate } from "@/lib/labour/operations";

function text(value: unknown) { const result = String(value ?? "").trim(); return result || null; }
async function authorized(request: Request) { return requireLabourPermission(request, "labour_attendance_unlock", "approve"); }

export async function GET(request: Request) {
  try {
    const access = await authorized(request); if ("response" in access) return access.response;
    let query = access.admin.from("attendance_historical_access").select("*").in("attendance_type", ["labour", "employee"]).order("from_date", { ascending: false });
    if (Array.isArray(access.organizationScope)) query = query.in("organization_id", access.organizationScope);
    if (access.assignments.siteIds?.length) query = query.in("site_id", access.assignments.siteIds);
    const { data, error } = await query; if (error) throw error;
    return NextResponse.json({ records: data || [] });
  } catch (error: any) { return jsonError(error.message || "Could not load attendance date access records.", 500); }
}

export async function POST(request: Request) {
  try {
    const access = await authorized(request); if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const attendanceType = payload.attendance_type === "employee" ? "employee" : payload.attendance_type === "labour" ? "labour" : null;
    const siteId = text(payload.site_id), fromDate = isoDate(payload.from_date), toDate = isoDate(payload.to_date), reason = text(payload.reason), expiresAt = text(payload.expires_at);
    if (!attendanceType) return jsonError("Attendance type is required.");
    if (!siteId || !fromDate || !toDate || !reason) return jsonError("Site, dates and reason are required.");
    if (fromDate > toDate) return jsonError("From date must be on or before To date.");
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return jsonError("Expiry must be a valid date and time.");
    const siteQuery = access.admin.from("sites").select("id, organization_id, company_id, status").eq("id", siteId).maybeSingle();
    const { data: site, error: siteError } = await siteQuery; if (siteError) throw siteError;
    const organizationId = site?.organization_id; if (!site || !organizationId || site.status !== "active") return jsonError("Selected site is not available.", 403);
    if (Array.isArray(access.organizationScope) && !access.organizationScope.includes(organizationId)) return jsonError("Selected site is outside your organization scope.", 403);
    if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(siteId)) return jsonError("Selected site is outside your assigned scope.", 403);
    const now = new Date().toISOString();
    const actor = actorFields(access.auth, "opened" as any);
    const { data, error } = await access.admin.rpc("open_attendance_historical_access", {
      p_organization_id: organizationId, p_attendance_type: attendanceType, p_site_id: siteId,
      p_from_date: fromDate, p_to_date: toDate, p_reason: reason, p_opens_at: now, p_expires_at: expiresAt || null,
      p_opened_by: actor.opened_by, p_opened_by_name: actor.opened_by_name, p_opened_by_email: actor.opened_by_email,
    });
    if (error) { if (error.code === "23P01") return jsonError(error.message, 409); throw error; }
    await audit(access, request, { moduleCode: "labour_attendance_unlock", action: "approve", entityType: "attendance_historical_access", recordId: data.id, organizationId, siteId, description: `Opened ${attendanceType === "employee" ? "Employee" : "Labour"} Attendance access from ${fromDate} to ${toDate}.`, newValues: data });
    return NextResponse.json({ record: data }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Could not open historical attendance access.", 500); }
}

export async function PATCH(request: Request) {
  try {
    const access = await authorized(request); if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({})); const id = text(payload.id); const closeReason = text(payload.close_reason);
    if (!id) return jsonError("Access record is required.");
    const { data: existing, error: loadError } = await access.admin.from("attendance_historical_access").select("*").eq("id", id).maybeSingle(); if (loadError) throw loadError;
    if (!existing) return jsonError("Attendance access record not found.", 404);
    const { data: site, error: siteError } = await access.admin.from("sites").select("id, organization_id, status").eq("id", existing.site_id).maybeSingle(); if (siteError) throw siteError;
    if (!site || site.organization_id !== existing.organization_id || site.status !== "active") return jsonError("Access record is outside your scope.", 403);
    if (Array.isArray(access.organizationScope) && !access.organizationScope.includes(existing.organization_id)) return jsonError("Access record is outside your organization scope.", 403);
    if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(existing.site_id)) return jsonError("Access record is outside your assigned scope.", 403);
    if (existing.status === "closed") return NextResponse.json({ record: existing });
    const now = new Date().toISOString(); const updatePayload = { status: "closed", closed_at: now, close_reason: closeReason, updated_at: now, ...actorFields(access.auth, "closed" as any) };
    const { data, error } = await access.admin.from("attendance_historical_access").update(updatePayload).eq("id", id).eq("status", "open").select("*").single(); if (error) throw error;
    await audit(access, request, { moduleCode: "labour_attendance_unlock", action: "approve", entityType: "attendance_historical_access", recordId: id, organizationId: existing.organization_id, siteId: existing.site_id, description: `Closed ${existing.attendance_type === "employee" ? "Employee" : "Labour"} Attendance historical access.`, oldValues: existing, newValues: data });
    return NextResponse.json({ record: data });
  } catch (error: any) { return jsonError(error.message || "Could not close historical attendance access.", 500); }
}
