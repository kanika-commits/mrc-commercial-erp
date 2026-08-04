import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { dateText, numberOrNull, rangesOverlap } from "@/lib/labour/v2";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

async function loadMwo(access: any, id: string) {
  const { data, error } = await access.admin.from("manpower_work_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (access.organizationScope !== null && !access.organizationScope.includes(data.organization_id)) return null;
  if (access.assignments.companyIds?.length && !access.assignments.companyIds.includes(data.company_id)) return null;
  if (access.assignments.siteIds?.length && !access.assignments.siteIds.includes(data.site_id)) return null;
  return data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_manpower_work_orders", "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const mwo = await loadMwo(access, id);
    if (!mwo) return jsonError("Manpower Work Order not found.", 404);
    if (mwo.status !== "draft") return jsonError("Category rates can be edited only while the Manpower Work Order is in Draft.", 403);
    const payload = await request.json().catch(() => ({}));
    const labourTradeId = text(payload.labour_trade_id);
    const dailyRate = numberOrNull(payload.daily_rate);
    const effectiveFrom = dateText(payload.effective_from) || mwo.effective_from;
    const effectiveTo = dateText(payload.effective_to);
    if (!labourTradeId) return jsonError("Labour Category is required.");
    if (dailyRate === null || dailyRate < 0) return jsonError("Daily rate must be non-negative.");
    if (effectiveTo && effectiveTo < effectiveFrom) return jsonError("Rate Effective To cannot be before Effective From.");

    const { data: existingRates, error: existingError } = await access.admin
      .from("manpower_work_order_rates")
      .select("effective_from, effective_to, status")
      .eq("manpower_work_order_id", id)
      .eq("labour_trade_id", labourTradeId)
      .neq("status", "cancelled");
    if (existingError) throw existingError;
    if ((existingRates || []).some((rate: any) => rangesOverlap(rate.effective_from, rate.effective_to, effectiveFrom, effectiveTo))) {
      return jsonError("Rate overlaps an existing effective category rate.", 409);
    }

    const revisionNumber = Math.max(0, ...(existingRates || []).map((rate: any) => Number(rate.revision_number || 0))) + 1;
    const insertPayload = {
      manpower_work_order_id: id,
      organization_id: mwo.organization_id,
      company_id: mwo.company_id,
      site_id: mwo.site_id,
      contractor_profile_id: mwo.contractor_profile_id,
      labour_trade_id: labourTradeId,
      daily_rate: dailyRate,
      overtime_rate: null,
      contractor_profit_override: numberOrNull(payload.contractor_profit_override),
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: "active",
      revision_number: revisionNumber,
      reason: text(payload.reason),
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("manpower_work_order_rates").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_manpower_work_orders",
      action: "create",
      entityType: "manpower_work_order_rate",
      recordId: data.id,
      parentEntityType: "manpower_work_order",
      parentRecordId: id,
      organizationId: mwo.organization_id,
      companyId: mwo.company_id,
      siteId: mwo.site_id,
      description: "Added Manpower Work Order category rate.",
      newValues: insertPayload,
    });
    return NextResponse.json({ rate_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save category rate.", 500);
  }
}
