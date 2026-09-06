import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { adminClient, actorFields, applyOrganizationAccess, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

async function loadMake(admin: any, auth: any, id: string) {
  const query = applyOrganizationAccess(admin.from("procurement_site_item_approved_makes").select("*, item:procurement_items(id, item_code, item_name), site:sites(id, site_name)").eq("id", id).neq("status", "deleted").maybeSingle(), auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  if (data && !auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner") && (auth.sites || []).length > 0 && !(auth.sites || []).includes(data.site_id)) return null;
  return data;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "edit");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadMake(admin, auth, id);
    if (!existing) return jsonError("Approved make was not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const makeName = text(payload.make_name);
    if (!makeName) return jsonError("Make name is required.", 400);
    const updatePayload = { make_name: makeName, status: text(payload.status) || "active", sort_order: Number(payload.sort_order) || 0, remarks: text(payload.remarks) || null, ...actorFields(auth.user), updated_at: new Date().toISOString() };
    const { error } = await admin.from("procurement_site_item_approved_makes").update(updatePayload).eq("id", id);
    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate")) return jsonError("This make already exists for the selected Site and Item.", 409);
      throw error;
    }
    try { await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, siteId: existing.site_id, moduleCode: ITEM_MODULE, entityType: "procurement_site_item_approved_make", recordId: id, recordNumber: makeName, action: updatePayload.status === "inactive" ? "deactivate" : "update", actionCategory: updatePayload.status === "inactive" ? "status_change" : "update", activityLabel: updatePayload.status === "inactive" ? "Inactivated Site Approved Make" : "Updated Site Approved Make", description: `${updatePayload.status === "inactive" ? "Inactivated" : "Updated"} approved make ${makeName} for ${existing.item?.item_code || "item"}.`, oldValues: existing, newValues: updatePayload }, request); } catch (auditError) { console.error("[Procurement Audit] Approved make update audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update approved make." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "edit");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadMake(admin, auth, id);
    if (!existing) return jsonError("Approved make was not found.", 404);
    const updatePayload = { status: "inactive", ...actorFields(auth.user), updated_at: new Date().toISOString() };
    const { error } = await admin.from("procurement_site_item_approved_makes").update(updatePayload).eq("id", id);
    if (error) throw error;
    try { await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, siteId: existing.site_id, moduleCode: ITEM_MODULE, entityType: "procurement_site_item_approved_make", recordId: id, recordNumber: existing.make_name, action: "deactivate", actionCategory: "status_change", activityLabel: "Inactivated Site Approved Make", description: `Inactivated approved make ${existing.make_name}.`, oldValues: existing, newValues: updatePayload }, request); } catch (auditError) { console.error("[Procurement Audit] Approved make delete audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to inactivate approved make." }, { status: 500 });
  }
}
