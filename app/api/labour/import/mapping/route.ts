import { NextResponse } from "next/server";
import { jsonError, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";

function mappingObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export async function PATCH(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    if (!payload.batch_id) return jsonError("Batch ID is required.");
    const batch = await loadScopedLabourImportBatch(access, payload.batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);
    const currentMapping = mappingObject(batch.mapping);
    const incomingMapping = mappingObject(payload.mapping);
    const { error } = await access.admin.from("labour_import_batches").update({
      mapping: { ...currentMapping, ...incomingMapping },
      updated_at: new Date().toISOString(),
    }).eq("id", payload.batch_id);
    if (error) throw error;
    return NextResponse.json({ batch_id: payload.batch_id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to save labour import mapping.", 500);
  }
}
