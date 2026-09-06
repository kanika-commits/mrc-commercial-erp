import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { adminClient, actorFields, applyOrganizationAccess, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

async function loadItem(admin: any, auth: any, id: string) {
  const query = applyOrganizationAccess(admin.from("procurement_items").select("*, default_uom:procurement_uoms(id, uom_code, uom_name), item_type:procurement_item_types(id, type_code, type_name), item_group:procurement_item_groups(id, group_code, group_name)").eq("id", id).maybeSingle(), auth);
  if (!query) return null;
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const item = await loadItem(adminClient(), auth, id);
    if (!item) return jsonError("Item was not found.", 404);
    return NextResponse.json({ item });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load item." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "edit");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadItem(admin, auth, id);
    if (!existing) return jsonError("Item was not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const itemName = text(payload.item_name);
    const itemTypeId = text(payload.item_type_id);
    const itemGroupId = text(payload.item_group_id);
    const defaultUomId = text(payload.default_uom_id);
    if (!itemName) return jsonError("Item name is required.", 400);
    if (!itemTypeId) return jsonError("Item Type is required.", 400);
    if (!itemGroupId) return jsonError("Item Group is required.", 400);
    if (!defaultUomId) return jsonError("Default UOM is required.", 400);
    const { data: duplicate, error: duplicateError } = await admin.from("procurement_items").select("id").eq("organization_id", existing.organization_id).ilike("item_name", itemName).neq("id", id).neq("status", "deleted").limit(1).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return jsonError("Item name already exists in this organization.", 409);
    const [typeResult, groupResult, uomResult] = await Promise.all([
      admin.from("procurement_item_types").select("id, type_name").eq("id", itemTypeId).eq("organization_id", existing.organization_id).eq("status", "active").maybeSingle(),
      admin.from("procurement_item_groups").select("id, item_type_id, group_name").eq("id", itemGroupId).eq("organization_id", existing.organization_id).eq("status", "active").maybeSingle(),
      admin.from("procurement_uoms").select("id").eq("id", defaultUomId).eq("organization_id", existing.organization_id).eq("status", "active").maybeSingle(),
    ]);
    if (typeResult.error) throw typeResult.error;
    if (groupResult.error) throw groupResult.error;
    if (uomResult.error) throw uomResult.error;
    if (!typeResult.data) return jsonError("Selected Item Type is invalid.", 400);
    if (!groupResult.data || groupResult.data.item_type_id !== itemTypeId) return jsonError("Selected Item Group is invalid for the Item Type.", 400);
    if (!uomResult.data) return jsonError("Selected Default UOM is invalid.", 400);
    const updatePayload = { item_name: itemName, item_type_id: itemTypeId, item_group_id: itemGroupId, item_category: groupResult.data.group_name, default_uom_id: defaultUomId, description: text(payload.description) || null, hsn_sac: text(payload.hsn_sac) || null, status: text(payload.status) || "active", ...actorFields(auth.user), updated_at: new Date().toISOString() };
    const { error } = await admin.from("procurement_items").update(updatePayload).eq("id", id);
    if (error) throw error;
    try {
      await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, moduleCode: ITEM_MODULE, entityType: "procurement_item", recordId: id, recordNumber: existing.item_code, action: "update", actionCategory: "update", activityLabel: "Updated Item", description: `Updated item ${existing.item_code}.`, oldValues: existing, newValues: updatePayload }, request);
    } catch (auditError) {
      console.error("[Procurement Audit] Item update audit failed", auditError);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update item." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "delete");
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const admin = adminClient();
    const existing = await loadItem(admin, auth, id);
    if (!existing) return jsonError("Item was not found.", 404);
    const { count, error: countError } = await admin.from("purchase_requisition_items").select("id", { count: "exact", head: true }).eq("item_id", id);
    if (countError) throw countError;
    if ((count || 0) > 0) return jsonError("Item is already used in requisitions and cannot be deleted.", 409);
    const updatePayload = { status: "deleted", ...actorFields(auth.user), updated_at: new Date().toISOString() };
    const { error } = await admin.from("procurement_items").update(updatePayload).eq("id", id);
    if (error) throw error;
    try {
      await recordAuditEvent(admin, auth.user, { organizationId: existing.organization_id, moduleCode: ITEM_MODULE, entityType: "procurement_item", recordId: id, recordNumber: existing.item_code, action: "delete", actionCategory: "delete", activityLabel: "Deleted Item", description: `Deleted item ${existing.item_code}.`, oldValues: existing, newValues: updatePayload }, request);
    } catch (auditError) {
      console.error("[Procurement Audit] Item delete audit failed", auditError);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete item." }, { status: 500 });
  }
}
