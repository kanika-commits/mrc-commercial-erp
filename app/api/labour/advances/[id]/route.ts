import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { isValidActionValue, LABOUR_RECOVERY_MODES, normalizeText } from "@/lib/labour/constants";
import { applyCompanySiteScope } from "@/app/api/labour/_shared";
import { applyOrganizationScope } from "@/lib/serverOrganizationScope";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function loadAdvance(access: any, id: string) {
  let query = access.admin.from("labour_advances").select("*").eq("id", id);
  const orgScoped = applyOrganizationScope(query, access.organizationScope);
  if (!orgScoped) return null;
  query = applyCompanySiteScope(orgScoped, access.assignments);
  if (!query) return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_advances", "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadAdvance(access, id);
    if (!current) return jsonError("Advance not found.", 404);
    if (current.status === "cancelled") return jsonError("Cancelled advance cannot be edited.");
    const payload = await request.json().catch(() => ({}));
    const amount = Number(payload.amount ?? current.amount);
    const mode = text(payload.recovery_mode) || current.recovery_mode;
    if (amount <= 0) return jsonError("Advance amount must be greater than zero.");
    if (Number(current.recovered_amount || 0) > amount) return jsonError("Advance amount cannot be less than recovered amount.");
    if (!isValidActionValue(LABOUR_RECOVERY_MODES, mode)) return jsonError("Invalid recovery mode.");
    const updatePayload = {
      advance_date: text(payload.advance_date) || current.advance_date,
      amount,
      purpose: text(payload.purpose),
      recovery_mode: mode,
      installment_amount: payload.installment_amount === "" || payload.installment_amount == null ? null : Number(payload.installment_amount),
      balance_amount: Math.max(0, amount - Number(current.recovered_amount || 0)),
      payment_reference: text(payload.payment_reference),
      remarks: text(payload.remarks),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    };
    const { error } = await access.admin.from("labour_advances").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_advances",
      action: "update",
      entityType: "labour_advance",
      recordId: id,
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      description: "Updated labour advance.",
      oldValues: current,
      newValues: updatePayload,
    });
    return NextResponse.json({ advance_id: id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labour advance.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_advances", "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadAdvance(access, id);
    if (!current) return jsonError("Advance not found.", 404);
    if (Number(current.recovered_amount || 0) > 0) return jsonError("Advance with recoveries cannot be cancelled.");
    const updatePayload = { status: "cancelled", balance_amount: 0, updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") };
    const { error } = await access.admin.from("labour_advances").update(updatePayload).eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_advances",
      action: "delete",
      entityType: "labour_advance",
      recordId: id,
      organizationId: current.organization_id,
      companyId: current.company_id,
      siteId: current.site_id,
      description: "Cancelled labour advance.",
      oldValues: current,
      newValues: updatePayload,
    });
    return NextResponse.json({ cancelled: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to cancel labour advance.", 500);
  }
}
