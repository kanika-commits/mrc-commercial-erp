import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { adminClient, applyOrganizationAccess, createActorFields, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "view");
    if ("response" in auth) return auth.response;
    const { searchParams } = new URL(request.url);
    const search = text(searchParams.get("search")).toLowerCase();
    const typeId = text(searchParams.get("item_type_id"));
    const groupId = text(searchParams.get("item_group_id"));
    const status = text(searchParams.get("status"));
    const admin = adminClient();
    let query = applyOrganizationAccess(admin.from("procurement_items").select("*, default_uom:procurement_uoms(id, uom_code, uom_name), item_type:procurement_item_types(id, type_code, type_name), item_group:procurement_item_groups(id, group_code, group_name)").neq("status", "deleted").order("item_code"), auth);
    if (!query) return NextResponse.json({ items: [], total_all: 0 });
    if (typeId && typeId !== "all") query = query.eq("item_type_id", typeId);
    if (groupId && groupId !== "all") query = query.eq("item_group_id", groupId);
    if (status && status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const loaded = data || [];
    const items = loaded.filter((item: any) => !search || [item.item_code, item.item_name, item.item_type?.type_name, item.item_group?.group_name, item.description, item.hsn_sac].join(" ").toLowerCase().includes(search));
    return NextResponse.json({ items, total_all: loaded.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load items." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "add");
    if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({}));
    const admin = adminClient();
    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const organizationId = resolveWriteOrganizationId(organizationScope, payload.organization_id);
    if (!organizationId) return jsonError("You cannot create items outside your organization.", 403);
    const itemName = text(payload.item_name);
    const itemTypeId = text(payload.item_type_id);
    const itemGroupId = text(payload.item_group_id);
    const defaultUomId = text(payload.default_uom_id);
    if (!itemName) return jsonError("Item name is required.", 400);
    if (!itemTypeId) return jsonError("Item Type is required.", 400);
    if (!itemGroupId) return jsonError("Item Group is required.", 400);
    if (!defaultUomId) return jsonError("Default UOM is required.", 400);
    const { data: duplicate, error: duplicateError } = await admin.from("procurement_items").select("id").eq("organization_id", organizationId).ilike("item_name", itemName).neq("status", "deleted").limit(1).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return jsonError("Item name already exists in this organization.", 409);
    const [typeResult, groupResult, uomResult] = await Promise.all([
      admin.from("procurement_item_types").select("id, type_name").eq("id", itemTypeId).eq("organization_id", organizationId).eq("status", "active").maybeSingle(),
      admin.from("procurement_item_groups").select("id, item_type_id, group_name").eq("id", itemGroupId).eq("organization_id", organizationId).eq("status", "active").maybeSingle(),
      admin.from("procurement_uoms").select("id").eq("id", defaultUomId).eq("organization_id", organizationId).neq("status", "deleted").maybeSingle(),
    ]);
    if (typeResult.error) throw typeResult.error;
    if (groupResult.error) throw groupResult.error;
    if (uomResult.error) throw uomResult.error;
    if (!typeResult.data) return jsonError("Selected Item Type was not found.", 404);
    if (!groupResult.data || groupResult.data.item_type_id !== itemTypeId) return jsonError("Selected Item Group is invalid for the Item Type.", 400);
    if (!uomResult.data) return jsonError("Selected UOM was not found.", 404);
    const { data: code, error: codeError } = await admin.rpc("next_procurement_item_code", { p_organization_id: organizationId });
    if (codeError) throw codeError;
    const insertPayload = { organization_id: organizationId, item_code: code, item_name: itemName, item_type_id: itemTypeId, item_group_id: itemGroupId, item_category: groupResult.data.group_name, default_uom_id: defaultUomId, description: text(payload.description) || null, hsn_sac: text(payload.hsn_sac) || null, status: text(payload.status) || "active", ...createActorFields(auth.user) };
    const { data, error } = await admin.from("procurement_items").insert(insertPayload).select("id, item_code").single();
    if (error) throw error;
    try { await recordAuditEvent(admin, auth.user, { organizationId, moduleCode: ITEM_MODULE, entityType: "procurement_item", recordId: data.id, recordNumber: data.item_code, action: "create", actionCategory: "create", activityLabel: "Created Item", description: `Created item ${itemName}.`, newValues: insertPayload }, request); } catch (auditError) { console.error("[Procurement Audit] Item create audit failed", auditError); }
    return NextResponse.json({ item_id: data.id, item_code: data.item_code });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create item." }, { status: 500 });
  }
}
