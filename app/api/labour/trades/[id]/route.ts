import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeIdentifier, normalizeLookup, normalizeText } from "@/lib/labour/constants";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

const MODULE = "labour_trades";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function validStatus(value: unknown, fallback = "active") {
  const status = text(value) || fallback;
  return status === "inactive" ? "inactive" : "active";
}

async function loadTrade(access: any, id: string) {
  let query = access.admin.from("labour_trades").select("*").eq("id", id).neq("status", "deleted");
  const scoped = applyOrganizationScope(query, access.organizationScope);
  if (!scoped) return null;
  const { data, error } = await scoped.maybeSingle();
  if (error) throw error;
  return data;
}

async function findDuplicate(access: any, organizationId: string, tradeName: string, tradeCode: string, excludeId: string) {
  const { data, error } = await access.admin
    .from("labour_trades")
    .select("id, trade_name, trade_code")
    .eq("organization_id", organizationId)
    .neq("status", "deleted")
    .neq("id", excludeId);
  if (error) throw error;
  const nameKey = normalizeLookup(tradeName);
  const codeKey = normalizeIdentifier(tradeCode);
  if ((data || []).some((row: any) => normalizeLookup(row.trade_name) === nameKey)) {
    return "A labour category with this name already exists.";
  }
  if ((data || []).some((row: any) => normalizeIdentifier(row.trade_code) === codeKey)) {
    return "A labour category with this code already exists.";
  }
  return null;
}

async function countReferences(access: any, id: string) {
  const checks = await Promise.all([
    access.admin.from("labour_workers").select("id", { count: "exact", head: true }).eq("labour_trade_id", id).neq("status", "deleted"),
    access.admin.from("labour_deployments").select("id", { count: "exact", head: true }).eq("labour_trade_id", id),
    access.admin.from("manpower_work_order_rates").select("id", { count: "exact", head: true }).eq("labour_trade_id", id),
    access.admin.from("labour_wage_rates").select("id", { count: "exact", head: true }).eq("trade_id", id),
    access.admin.from("labour_worker_rate_overrides").select("id", { count: "exact", head: true }).eq("labour_trade_id", id),
  ]);
  for (const result of checks) {
    if (result.error) throw result.error;
  }
  return checks.reduce((total, result) => total + Number(result.count || 0), 0);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadTrade(access, id);
    if (!current) return jsonError("Labour category not found.", 404);

    const payload = await request.json().catch(() => ({}));
    const tradeName = text(payload.trade_name);
    const tradeCode = normalizeIdentifier(payload.trade_code);
    if (!tradeName) return jsonError("Category name is required.");
    if (!tradeCode) return jsonError("Category code is required.");
    const duplicate = await findDuplicate(access, current.organization_id, tradeName, tradeCode, id);
    if (duplicate) return jsonError(duplicate, 409);

    const updatePayload = {
      trade_name: tradeName,
      trade_code: tradeCode,
      description: text(payload.description),
      status: validStatus(payload.status, current.status),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_trades").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      action: "update",
      entityType: "labour_trade",
      recordId: id,
      organizationId: current.organization_id,
      description: `Updated labour category ${tradeName}.`,
      oldValues: current,
      newValues: updatePayload,
    });
    return NextResponse.json({ trade_id: id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labour category.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadTrade(access, id);
    if (!current) return jsonError("Labour category not found.", 404);
    const referenceCount = await countReferences(access, id);
    if (referenceCount > 0) {
      return jsonError("This category is already in use and cannot be deleted. Mark it Inactive instead.", 409);
    }
    const { error } = await access.admin
      .from("labour_trades")
      .update({ status: "deleted", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
      .eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      action: "delete",
      entityType: "labour_trade",
      recordId: id,
      organizationId: current.organization_id,
      description: `Deleted labour category ${current.trade_name}.`,
      oldValues: current,
    });
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete labour category.", 500);
  }
}
