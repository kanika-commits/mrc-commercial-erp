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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const payload = await request.json().catch(() => ({}));
    const source = text(payload.source);
    const access = await requireWorkerStatusAccess(request, source);
    if ("response" in access) return access.response;

    const { id } = await context.params;
    const normalized = normalizeInactiveStatusPayload(payload);
    const validation = await validateInactiveWorkerStatusUpdate(access, {
      workerId: id,
      status: normalized.nextStatus,
      reason: normalized.reason,
      requestedDate: normalized.requestedDate,
    });
    if ("error" in validation) return jsonError(validation.error || "Failed to update labourer status.", validation.status || 400);

    const result = await applyInactiveWorkerStatusUpdate(access, request, {
      workerId: id,
      reason: normalized.reason as string,
      source: source as string,
      requestedDate: normalized.requestedDate,
      validation,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labourer status.", 500);
  }
}
