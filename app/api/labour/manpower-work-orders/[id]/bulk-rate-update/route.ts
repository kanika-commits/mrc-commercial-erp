import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, requireLabourPermission } from "@/app/api/labour/_shared";
import { dateText, numberOrNull, previousDate } from "@/lib/labour/v2";
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
    const access = await requireLabourPermission(request, "labour_rate_overrides", "approve");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const mwo = await loadMwo(access, id);
    if (!mwo) return jsonError("Manpower Work Order not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const labourTradeId = text(payload.labour_trade_id);
    const effectiveFrom = dateText(payload.effective_from);
    const dailyRate = numberOrNull(payload.daily_rate);
    const reason = text(payload.reason);
    if (!labourTradeId || !effectiveFrom) return jsonError("Labour Category and Effective From are required.");
    if (dailyRate === null || dailyRate < 0) return jsonError("New daily rate must be non-negative.");
    if (!reason) return jsonError("Rate revision reason is required.");

    const { data: activeRate, error: rateError } = await access.admin
      .from("manpower_work_order_rates")
      .select("*")
      .eq("manpower_work_order_id", id)
      .eq("labour_trade_id", labourTradeId)
      .eq("status", "active")
      .lte("effective_from", effectiveFrom)
      .or(`effective_to.is.null,effective_to.gte.${effectiveFrom}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rateError) throw rateError;
    const { data: workers, error: workerError } = await access.admin
      .from("labour_deployments")
      .select("labour_worker_id")
      .eq("manpower_work_order_id", id)
      .eq("labour_trade_id", labourTradeId)
      .eq("commercial_model", "daily_wage")
      .eq("status", "active")
      .lte("effective_from", effectiveFrom)
      .or(`effective_to.is.null,effective_to.gte.${effectiveFrom}`);
    if (workerError) throw workerError;

    if (payload.preview_only) {
      return NextResponse.json({ affected_worker_count: new Set((workers || []).map((row: any) => row.labour_worker_id)).size, current_rate: activeRate || null });
    }

    if (activeRate) {
      const closeDate = previousDate(effectiveFrom);
      if (closeDate < activeRate.effective_from) return jsonError("New effective date must be after the current rate starts.");
      const { error: closeError } = await access.admin.from("manpower_work_order_rates").update({
        effective_to: closeDate,
        status: "ended",
        ...actorFields(access.auth, "updated"),
        updated_at: new Date().toISOString(),
      }).eq("id", activeRate.id);
      if (closeError) throw closeError;
    }

    const revisionNumber = Number(activeRate?.revision_number || 0) + 1;
    const insertPayload = {
      manpower_work_order_id: id,
      organization_id: mwo.organization_id,
      company_id: mwo.company_id,
      site_id: mwo.site_id,
      contractor_profile_id: mwo.contractor_profile_id,
      labour_trade_id: labourTradeId,
      daily_rate: dailyRate,
      overtime_rate: null,
      effective_from: effectiveFrom,
      status: "active",
      revision_number: revisionNumber,
      reason,
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("manpower_work_order_rates").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_rate_overrides",
      action: "update",
      entityType: "manpower_work_order_rate",
      recordId: data.id,
      parentEntityType: "manpower_work_order",
      parentRecordId: id,
      organizationId: mwo.organization_id,
      companyId: mwo.company_id,
      siteId: mwo.site_id,
      description: "Bulk updated Manpower Work Order category rate.",
      oldValues: activeRate,
      newValues: { ...insertPayload, affected_worker_count: new Set((workers || []).map((row: any) => row.labour_worker_id)).size },
    });
    return NextResponse.json({ rate_id: data.id, affected_worker_count: new Set((workers || []).map((row: any) => row.labour_worker_id)).size });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update category rate.", 500);
  }
}
