import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/auditEvent";
import { loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { adminClient, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

function codeFor(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "MASTER"; }

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "add");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const kind = text(body.kind);
    const name = text(body.name);
    if (!(kind === "type" || kind === "group" || kind === "uom")) return jsonError("Choose an Item Type, Item Group, or UOM.", 400);
    if (!name) return jsonError(`${kind === "type" ? "Item Type" : kind === "group" ? "Item Group" : "UOM"} name is required.`, 400);
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const organizationId = resolveWriteOrganizationId(scope);
    if (!organizationId) return jsonError("Your account is not scoped to one organization.", 403);
    if (kind === "uom") {
      const code = text(body.code).toUpperCase();
      if (!code) return jsonError("UOM Code / Symbol is required.", 400);
      const duplicate = await admin.from("procurement_uoms").select("id").eq("organization_id", organizationId).ilike("uom_code", code).neq("status", "deleted").limit(1).maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) return jsonError("UOM already exists.", 409);
      const { data, error } = await admin.from("procurement_uoms").insert({ organization_id: organizationId, uom_code: code, uom_name: name, status: "active" }).select("id,uom_code,uom_name").single();
      if (error) { if (error.code === "23505") return jsonError("UOM already exists.", 409); throw error; }
      await recordAuditEvent(admin, auth.user, { organizationId, moduleCode: ITEM_MODULE, entityType: "procurement_uom", recordId: data.id, action: "create", description: `Created UOM ${data.uom_code} - ${data.uom_name}.`, newValues: data }, request);
      return NextResponse.json({ kind, id: data.id, name: data.uom_name, code: data.uom_code });
    }
    if (kind === "type") {
      const duplicate = await admin.from("procurement_item_types").select("id").eq("organization_id", organizationId).ilike("type_name", name).neq("status", "deleted").limit(1).maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) return jsonError("Item Type already exists.", 409);
      const { data, error } = await admin.from("procurement_item_types").insert({ organization_id: organizationId, type_code: codeFor(name), type_name: name, status: "active" }).select("id,type_name").single();
      if (error) { if (error.code === "23505") return jsonError("Item Type already exists.", 409); throw error; }
      await recordAuditEvent(admin, auth.user, { organizationId, moduleCode: ITEM_MODULE, entityType: "procurement_item_type", recordId: data.id, action: "create", description: `Created Item Type ${name}.`, newValues: data }, request);
      return NextResponse.json({ kind, id: data.id, name: data.type_name });
    }
    const itemTypeId = text(body.item_type_id);
    if (!itemTypeId) return jsonError("Select an Item Type before adding a Group.", 400);
    const type = await admin.from("procurement_item_types").select("id").eq("id", itemTypeId).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (type.error) throw type.error;
    if (!type.data) return jsonError("Selected Item Type was not found.", 404);
    const duplicate = await admin.from("procurement_item_groups").select("id").eq("organization_id", organizationId).eq("item_type_id", itemTypeId).ilike("group_name", name).neq("status", "deleted").limit(1).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) return jsonError("Item Group already exists.", 409);
    const { data, error } = await admin.from("procurement_item_groups").insert({ organization_id: organizationId, item_type_id: itemTypeId, group_code: codeFor(name), group_name: name, status: "active" }).select("id,group_name,item_type_id").single();
    if (error) { if (error.code === "23505") return jsonError("Item Group already exists.", 409); throw error; }
    await recordAuditEvent(admin, auth.user, { organizationId, moduleCode: ITEM_MODULE, entityType: "procurement_item_group", recordId: data.id, action: "create", description: `Created Item Group ${name}.`, newValues: data }, request);
    return NextResponse.json({ kind, id: data.id, name: data.group_name, item_type_id: data.item_type_id });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not create item master." }, { status: 500 }); }
}
