import { NextResponse } from "next/server";
import { loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { adminClient, ITEM_MODULE, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "view");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    let query = admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status,created_at,updated_at").neq("status", "deleted").order("item_header");
    const organizationId = resolveWriteOrganizationId(scope);
    if (scope === null) {
      query = organizationId ? query.eq("organization_id", organizationId) : query.limit(0);
    } else {
      query = query.in("organization_id", scope);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (error: any) { return jsonError(error.message || "Could not load Work Order Item Master.", 500); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "add");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const itemHeader = text(body.item_header);
    const description = text(body.description) || null;
    const unit = text(body.unit);
    const mode = text(body.mode_of_measurement);
    if (!itemHeader || !unit || !mode) return jsonError("Item Header, Unit, and Mode of Measurement are required.", 400);
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const targetOrganizationId = resolveWriteOrganizationId(scope);
    if (!targetOrganizationId) return jsonError("Your account is not scoped to one organization.", 403);
    const { data, error } = await admin.from("work_order_item_masters").insert({ organization_id: targetOrganizationId, item_header: itemHeader, description, unit, mode_of_measurement: mode, created_by: auth.user.id, created_by_name: auth.user.user_metadata?.full_name || auth.user.email, created_by_email: auth.user.email || null, updated_by: auth.user.id, updated_by_name: auth.user.user_metadata?.full_name || auth.user.email, updated_by_email: auth.user.email || null }).select("id,organization_id,item_header,description,unit,mode_of_measurement,status").single();
    if (error?.code === "23505") return jsonError("A Work Order Item Master with this header already exists.", 409);
    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Could not create Work Order Item Master.", 500); }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, ITEM_MODULE, "delete");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const id = text(body.id);
    if (!id) return jsonError("Item id is required.", 400);
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const organizationId = resolveWriteOrganizationId(scope);
    if (!organizationId) return jsonError("Your account is not scoped to one organization.", 403);
    const { data, error } = await admin.rpc("delete_work_order_item_master_atomic", {
      p_organization_id: organizationId,
      p_id: id,
      p_actor_id: auth.user.id,
      p_actor_name: auth.user.user_metadata?.full_name || auth.user.email || null,
      p_actor_email: auth.user.email || null,
    });
    if (error) {
      if (error.message === "NOT_FOUND") return jsonError("Item was not found in your organization.", 404);
      if (error.message === "INVALID_REQUEST") return jsonError("Invalid delete request.", 400);
      throw error;
    }
    const result = data?.result === "deactivated" ? "deactivated" : "deleted";
    return NextResponse.json({ result, message: result === "deactivated" ? "Item is referenced by a Work Order and was deactivated." : "Item deleted." });
  } catch (error: any) { return jsonError(error.message || "Could not delete Work Order Item Master.", 500); }
}
