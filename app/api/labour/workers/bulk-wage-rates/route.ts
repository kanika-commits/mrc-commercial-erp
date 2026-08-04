import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, loadScopedWorker, requireLabourPermission } from "@/app/api/labour/_shared";
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

function previousDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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

  const { data: deployment, error: deploymentError } = await access.admin
    .from("labour_deployments")
    .select("id, labour_worker_id, contractor_profile_id, company_id, site_id, work_order_id, labour_trade_id, skill_level, wage_rate, commercial_model, status, effective_from, effective_to, labour_trades(trade_name)")
    .eq("labour_worker_id", workerId)
    .eq("status", "active")
    .is("effective_to", null)
    .maybeSingle();
  if (deploymentError) throw deploymentError;
  if (!deployment) return { error: `${worker.labour_code || worker.worker_name} has no active deployment.` };
  if (deployment.commercial_model !== "daily_wage") return { error: `${worker.labour_code || worker.worker_name} is Contractual Labour and cannot receive a Daily Rate update.` };

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
      }));

    if (errors.length) {
      return NextResponse.json({ ok: false, selected: workerIds.length, will_update: 0, unchanged: 0, errors, rows: previewRows }, { status: 400 });
    }
    if (mode === "preview") {
      return NextResponse.json({ ok: true, selected: workerIds.length, will_update: previewRows.length, unchanged: 0, errors: [], rows: previewRows });
    }

    const insertedIds: string[] = [];
    for (const result of results as any[]) {
      if (result.close_previous_rate) {
        const { error: closeError } = await access.admin
          .from("labour_wage_rates")
          .update({ effective_to: previousDay(effectiveFrom), updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
          .eq("id", result.close_previous_rate.id);
        if (closeError) throw closeError;
      }
      const insertPayload = {
        organization_id: result.worker.organization_id,
        labour_worker_id: result.worker.id,
        deployment_id: result.deployment.id,
        contractor_profile_id: result.deployment.contractor_profile_id || result.worker.current_contractor_profile_id,
        company_id: result.deployment.company_id || result.worker.current_company_id,
        site_id: result.deployment.site_id || result.worker.current_site_id,
        work_order_id: result.deployment.work_order_id || result.worker.current_work_order_id,
        trade_id: result.deployment.labour_trade_id || result.worker.labour_trade_id,
        skill_level: result.deployment.skill_level || result.worker.skill_level,
        wage_type: "daily",
        base_rate: result.new_rate,
        overtime_rate_type: null,
        overtime_rate: null,
        weekly_off_paid: false,
        holiday_paid: false,
        effective_from: effectiveFrom,
        effective_to: null,
        status: "active",
        reason,
        ...actorFields(access.auth, "created"),
      };
      const { data, error } = await access.admin.from("labour_wage_rates").insert(insertPayload).select("id").single();
      if (error) throw error;
      insertedIds.push(data.id);
      await audit(access, request, {
        moduleCode: "labour_wage_rates",
        action: "create",
        entityType: "labour_wage_rate",
        recordId: data.id,
        parentEntityType: "labour_worker",
        parentRecordId: result.worker.id,
        organizationId: result.worker.organization_id,
        companyId: result.deployment.company_id,
        siteId: result.deployment.site_id,
        description: "Bulk changed labour daily rate.",
        oldValues: result.close_previous_rate ? { closed_previous_rate: result.close_previous_rate, effective_to: previousDay(effectiveFrom) } : { previous_rate: result.current_rate },
        newValues: insertPayload,
      });
    }

    return NextResponse.json({ ok: true, updated: insertedIds.length, wage_rate_ids: insertedIds, rows: previewRows });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update Daily Rates.", 500);
  }
}
