import { NextResponse } from "next/server";
import { actorFields, jsonError, loadScopedWorker, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { overlapsDateRange } from "@/lib/labour/operations";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function wholeRupee(value: unknown) {
  const next = String(value ?? "").trim();
  if (!/^\d+$/.test(next)) return null;
  const amount = Number(next);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function rateApplies(rate: any, date: string) {
  if (!rate || rate.status === "cancelled") return false;
  if (rate.effective_from && rate.effective_from > date) return false;
  if (rate.effective_to && rate.effective_to < date) return false;
  return true;
}

async function buildPreviewRow(access: any, workerId: string, effectiveFrom: string, newRate: number) {
  const worker = await loadScopedWorker(access, workerId);
  if (!worker) return { error: "Labourer not found." };
  if (worker.status !== "active") return { error: `${worker.labour_code || worker.worker_name} is not active.` };

  const { data: deployments, error: deploymentError } = await access.admin
    .from("labour_deployments")
    .select("id, labour_worker_id, contractor_profile_id, company_id, site_id, work_order_id, labour_trade_id, skill_level, wage_rate, commercial_model, wage_type, status, effective_from, effective_to, labour_trades(trade_name), work_orders(id, wo_number, wo_type, status, approval_status, is_deleted)")
    .eq("labour_worker_id", workerId)
    .eq("status", "active")
    .is("effective_to", null);
  if (deploymentError) throw deploymentError;
  const currentRows = deployments || [];
  const deployment = currentRows.length === 1 ? currentRows[0] : null;
  if (currentRows.length > 1) return { error: `${worker.labour_code || worker.worker_name} has multiple active deployments.` };
  if (!deployment) return { error: `${worker.labour_code || worker.worker_name} has no active deployment.` };
  const workOrder = deployment.work_orders || null;
  const conversionRequired = deployment.commercial_model !== "daily_wage";
  const approvedDailyWageWorkOrder = Boolean(
    workOrder &&
    workOrder.wo_type === "Daily Wage" &&
    workOrder.status === "active" &&
    workOrder.approval_status === "approved" &&
    workOrder.is_deleted === false,
  );
  if (conversionRequired && !approvedDailyWageWorkOrder) {
    return { error: `${worker.labour_code || worker.worker_name} is not linked to an approved Daily Wage Work Order.` };
  }

  const { data: existing, error: existingError } = await access.admin
    .from("labour_wage_rates")
    .select("id, base_rate, effective_from, effective_to, status")
    .eq("labour_worker_id", workerId)
    .neq("status", "cancelled");
  if (existingError) throw existingError;
  const currentRate = (existing || []).find((rate: any) => rateApplies(rate, effectiveFrom)) || null;
  const currentAmount = Number(currentRate?.base_rate ?? deployment.wage_rate ?? 0) || null;
  if (currentAmount === newRate) return { error: `${worker.labour_code || worker.worker_name} already has this Daily Rate.` };
  const closePreviousRate = currentRate && currentRate.effective_from < effectiveFrom && !currentRate.effective_to ? currentRate : null;
  if ((existing || []).some((rate: any) => rate.id !== closePreviousRate?.id && overlapsDateRange(effectiveFrom, null, rate.effective_from, rate.effective_to))) {
    return { error: `${worker.labour_code || worker.worker_name} has an overlapping wage-rate period.` };
  }

  return {
    worker,
    deployment,
    conversion_required: conversionRequired,
    current_work_order_type: workOrder?.wo_type || null,
    current_rate: currentAmount,
    new_rate: newRate,
    effective_from: effectiveFrom,
    close_previous_rate: closePreviousRate,
  };
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "change_rate");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const mode = payload.mode === "commit" ? "commit" : "preview";
    const workerIds = Array.from(new Set((Array.isArray(payload.labour_worker_ids) ? payload.labour_worker_ids : []).map((id: unknown) => text(id)).filter(Boolean))) as string[];
    const effectiveFrom = text(payload.effective_from);
    const newRate = wholeRupee(payload.base_rate);
    const reason = text(payload.reason);
    if (!workerIds.length) return jsonError("Select at least one labourer.");
    if (!effectiveFrom) return jsonError("Effective from date is required.");
    if (newRate === null) return jsonError("New Daily Rate must be a positive whole rupee amount.");
    if (!reason || reason.length < 10) return jsonError("Reason must be at least 10 characters.");

    const results = await Promise.all(workerIds.map((workerId) => buildPreviewRow(access, workerId, effectiveFrom, newRate)));
    const errors = results
      .map((result: any, index) => result.error ? { labour_worker_id: workerIds[index], error: result.error } : null)
      .filter(Boolean);
    const previewRows = results
      .filter((result: any) => !result.error)
      .map((result: any) => ({
        labour_worker_id: result.worker.id,
        labour_code: result.worker.labour_code,
        worker_name: result.worker.worker_name,
        current_rate: result.current_rate,
        new_rate: result.new_rate,
        effective_from: result.effective_from,
        deployment_id: result.deployment.id,
        conversion_required: result.conversion_required,
        current_work_order_type: result.current_work_order_type,
      }));

    if (errors.length) {
      return NextResponse.json({ ok: false, selected: workerIds.length, will_update: 0, unchanged: 0, errors, rows: previewRows }, { status: 400 });
    }
    if (mode === "preview") {
      return NextResponse.json({ ok: true, selected: workerIds.length, will_update: previewRows.length, unchanged: 0, errors: [], rows: previewRows });
    }

    const actor = actorFields(access.auth, "created");
    const { data: committed, error: commitError } = await access.admin.rpc("bulk_update_labour_daily_rates_atomic", {
      p_worker_ids: workerIds,
      p_base_rate: newRate,
      p_effective_from: effectiveFrom,
      p_reason: reason,
      p_actor_id: actor.created_by,
      p_actor_name: actor.created_by_name,
      p_actor_email: actor.created_by_email,
    });
    if (commitError) throw commitError;
    return NextResponse.json({ ok: true, updated: committed?.updated || workerIds.length, wage_rate_ids: committed?.wage_rate_ids || [], rows: previewRows });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update Daily Rates.", 500);
  }
}
