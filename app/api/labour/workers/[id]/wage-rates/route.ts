import { NextResponse } from "next/server";
import {
  actorFields,
  audit,
  jsonError,
  loadScopedWorker,
  requireLabourPermission,
  validateTrade,
  validateWorkOrder,
} from "@/app/api/labour/_shared";
import { isValidActionValue, normalizeText, WAGE_TYPES } from "@/lib/labour/constants";
import { overlapsDateRange } from "@/lib/labour/operations";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function previousDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function wholeRupee(value: unknown) {
  const next = String(value ?? "").trim();
  if (!/^\d+$/.test(next)) return null;
  const amount = Number(next);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "change_rate");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const { data, error } = await access.admin
      .from("labour_wage_rates")
      .select("*, labour_trades(trade_name, trade_code), work_orders(wo_number)")
      .eq("labour_worker_id", id)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ wage_rates: data || [] });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load wage rates.", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "change_rate");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const worker = await loadScopedWorker(access, id);
    if (!worker) return jsonError("Labourer not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const wageType = text(payload.wage_type) || "daily";
    const effectiveFrom = text(payload.effective_from);
    const effectiveTo = text(payload.effective_to);
    const baseRate = wholeRupee(payload.base_rate);
    const reason = text(payload.reason);
    if (!isValidActionValue(WAGE_TYPES, wageType)) return jsonError("Invalid wage type.");
    if (!effectiveFrom) return jsonError("Effective from date is required.");
    if (!reason || reason.length < 10) return jsonError("Reason must be at least 10 characters.");
    if (baseRate === null) return jsonError("New Daily Rate must be a positive whole rupee amount.");
    if (effectiveTo && effectiveTo < effectiveFrom) return jsonError("Effective to cannot be before effective from.");
    const tradeCheck = await validateTrade(access, worker.organization_id, payload.trade_id || worker.labour_trade_id);
    if ("error" in tradeCheck) return jsonError(tradeCheck.error || "Selected labour category is not available.", 403);
    const workOrderCheck = await validateWorkOrder(access, worker.organization_id, worker.current_company_id, worker.current_site_id, payload.work_order_id || worker.current_work_order_id);
    if ("error" in workOrderCheck) return jsonError(workOrderCheck.error || "Selected Work Order is not available.", 403);

    const { data: existing, error: existingError } = await access.admin
      .from("labour_wage_rates")
      .select("id, base_rate, effective_from, effective_to, status")
      .eq("labour_worker_id", id)
      .neq("status", "cancelled");
    if (existingError) throw existingError;
    const currentRate = (existing || []).find((rate: any) => rate.effective_from <= effectiveFrom && (!rate.effective_to || rate.effective_to >= effectiveFrom));
    if (currentRate && Number(currentRate.base_rate) === baseRate) {
      return jsonError("New Daily Rate must differ from the currently effective rate.");
    }
    const closePreviousRate = currentRate && currentRate.effective_from < effectiveFrom && !currentRate.effective_to ? currentRate : null;
    if ((existing || []).some((rate: any) => rate.id !== closePreviousRate?.id && overlapsDateRange(effectiveFrom, effectiveTo, rate.effective_from, rate.effective_to))) {
      return jsonError("Wage rate dates overlap an existing wage rate.");
    }

    if (closePreviousRate) {
      const { error: closeError } = await access.admin
        .from("labour_wage_rates")
        .update({ effective_to: previousDay(effectiveFrom), updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
        .eq("id", closePreviousRate.id);
      if (closeError) throw closeError;
    }

    const { data: deployment, error: deploymentError } = await access.admin
      .from("labour_deployments")
      .select("id, contractor_profile_id, company_id, site_id, work_order_id, labour_trade_id, skill_level")
      .eq("labour_worker_id", id)
      .eq("status", "active")
      .is("effective_to", null)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment?.company_id || !deployment?.site_id) return jsonError("A current deployment is required before updating Daily Rate.", 409);

    const insertPayload = {
      organization_id: worker.organization_id,
      labour_worker_id: id,
      deployment_id: text(payload.deployment_id) || deployment?.id || null,
      contractor_profile_id: deployment?.contractor_profile_id || worker.current_contractor_profile_id,
      company_id: deployment?.company_id || worker.current_company_id,
      site_id: deployment?.site_id || worker.current_site_id,
      work_order_id: text(payload.work_order_id) || deployment?.work_order_id || worker.current_work_order_id,
      trade_id: text(payload.trade_id) || deployment?.labour_trade_id || worker.labour_trade_id,
      skill_level: text(payload.skill_level) || deployment?.skill_level || worker.skill_level,
      wage_type: wageType,
      base_rate: baseRate,
      overtime_rate_type: null,
      overtime_rate: null,
      weekly_off_paid: Boolean(payload.weekly_off_paid),
      holiday_paid: Boolean(payload.holiday_paid),
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: text(payload.status) || "active",
      reason,
      ...actorFields(access.auth, "created"),
    };
    const { data, error } = await access.admin.from("labour_wage_rates").insert(insertPayload).select("id").single();
    if (error) throw error;
    await audit(access, request, {
      moduleCode: "labour_wage_rates",
      action: "create",
      entityType: "labour_wage_rate",
      recordId: data.id,
      parentEntityType: "labour_worker",
      parentRecordId: id,
      organizationId: worker.organization_id,
      companyId: worker.current_company_id,
      siteId: worker.current_site_id,
      description: "Changed labour daily rate.",
      oldValues: closePreviousRate ? { closed_previous_rate: closePreviousRate, effective_to: previousDay(effectiveFrom) } : currentRate ? { previous_rate: currentRate } : null,
      newValues: insertPayload,
    });
    return NextResponse.json({ wage_rate_id: data.id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save wage rate.", 500);
  }
}
