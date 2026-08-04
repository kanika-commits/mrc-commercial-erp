import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/labour/_shared";
import {
  applyInactiveWorkerStatusUpdate,
  normalizeInactiveStatusPayload,
  requireWorkerStatusAccess,
  validateInactiveWorkerStatusUpdate,
} from "@/app/api/labour/workers/_status";
import { normalizeText } from "@/lib/labour/constants";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const access = await requireWorkerStatusAccess(request, "labour_worker_detail");
    if ("response" in access) return access.response;

    const mode = payload.mode === "commit" ? "commit" : "preview";
    const workerIds = Array.from(new Set((Array.isArray(payload.labour_worker_ids) ? payload.labour_worker_ids : []).map((id: unknown) => text(id)).filter(Boolean))) as string[];
    const normalized = normalizeInactiveStatusPayload(payload);

    if (!workerIds.length) return jsonError("Select at least one labourer.");
    if (!normalized.requestedDate) return jsonError("Effective Date is required.");
    if (normalized.nextStatus !== "inactive") return jsonError("Only marking labourers inactive is supported here.");
    if (!normalized.reason || normalized.reason.length < 10) return jsonError("Reason must be at least 10 characters.");

    const validations = await Promise.all(workerIds.map((workerId) => validateInactiveWorkerStatusUpdate(access, {
      workerId,
      status: normalized.nextStatus,
      reason: normalized.reason,
      requestedDate: normalized.requestedDate,
    })));
    const errors = validations
      .map((validation: any, index) => {
        if ("error" in validation) return { labour_worker_id: workerIds[index], error: validation.error };
        if (validation.unchanged) return { labour_worker_id: workerIds[index], error: `${validation.worker?.labour_code || validation.worker?.worker_name || "Selected labourer"} is already inactive.` };
        return null;
      })
      .filter(Boolean);
    const rows = validations
      .filter((validation: any) => !("error" in validation))
      .map((validation: any) => ({
        labour_worker_id: validation.worker.id,
        labour_code: validation.worker.labour_code,
        worker_name: validation.worker.worker_name,
        current_status: validation.worker.status,
        new_status: "inactive",
        effective_date: validation.effectiveDate,
        unchanged: Boolean(validation.unchanged),
      }));

    if (errors.length) {
      return NextResponse.json({ ok: false, selected: workerIds.length, will_update: 0, unchanged: 0, errors, rows }, { status: 400 });
    }
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        selected: workerIds.length,
        will_update: rows.filter((row) => !row.unchanged).length,
        unchanged: rows.filter((row) => row.unchanged).length,
        errors: [],
        rows,
      });
    }

    const results = [];
    for (let index = 0; index < workerIds.length; index += 1) {
      const result = await applyInactiveWorkerStatusUpdate(access, request, {
        workerId: workerIds[index],
        reason: normalized.reason,
        source: "labour_worker_detail",
        requestedDate: normalized.requestedDate,
        validation: validations[index],
      });
      results.push(result);
    }

    return NextResponse.json({
      ok: true,
      updated: results.filter((result: any) => !result.unchanged).length,
      unchanged: results.filter((result: any) => result.unchanged).length,
      rows,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labourer statuses.", 500);
  }
}
