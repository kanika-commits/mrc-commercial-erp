import { NextResponse } from "next/server";
import { jsonError, loadScopedWorker, requireLabourPermission } from "@/app/api/labour/_shared";

const MAX_BULK_HARD_DELETE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "hard_delete");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(payload.labour_worker_ids) ? payload.labour_worker_ids : [];
    if (rawIds.some((id: unknown) => typeof id !== "string" || !UUID_RE.test(id))) return jsonError("Every Labour worker ID must be a valid UUID.", 400);
    const ids: string[] = Array.from(new Set(rawIds as string[]));
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (!ids.length) return jsonError("Select at least one safe labour worker.");
    if (ids.length > MAX_BULK_HARD_DELETE) return jsonError(`Bulk hard delete supports a maximum of ${MAX_BULK_HARD_DELETE} workers at a time.`, 400);
    if (!reason) return jsonError("A deletion reason is required.");
    for (const id of ids) if (!(await loadScopedWorker(access, id))) return jsonError("One or more selected workers are outside your scope.", 403);
    const { data, error } = await access.admin.rpc("bulk_hard_delete_labour_workers_atomic", {
      p_worker_ids: ids,
      p_actor_id: access.auth.user.id,
      p_actor_name: access.auth.user.user_metadata?.full_name || access.auth.user.email || "",
      p_actor_email: access.auth.user.email || "",
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json(data || { result: "deleted", workers_deleted: ids.length });
  } catch (error: any) {
    return jsonError(error.message || "Could not hard-delete Labour workers.", 409);
  }
}
