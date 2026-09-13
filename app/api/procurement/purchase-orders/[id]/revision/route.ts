import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission } from "@/lib/serverProcurementAccess";
import { copyObjectsWithCompensation, createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";

const excluded = new Set(["signed_po", "generated_po", "approved_po"]);
function actor(auth: any) { return { user_id: auth.user?.id || auth.user?.user_id, name: auth.user?.user_metadata?.full_name || auth.user?.email || "User", email: auth.user?.email || null }; }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const copied: Array<{ bucket: string; key: string }> = [];
  try {
    const auth = await requireProcurementPermission(request, "procurement_purchase_orders", "edit");
    if ("response" in auth) return auth.response;
    const id = (await context.params).id; const admin = adminClient();
    let query: any = applyCompanySiteAccess(applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*").eq("id", id).maybeSingle(), auth), auth);
    if (!query) return jsonError("Purchase Order was not found.", 404);
    const { data: po, error } = await query; if (error) throw error;
    if (!po) return jsonError("Purchase Order was not found.", 404);
    if (po.status !== "approved") return jsonError("Only an Approved Purchase Order can be revised.", 409);
    const { data: docs, error: docError } = await admin.from("procurement_purchase_order_documents").select("*").eq("purchase_order_id", id).eq("organization_id", po.organization_id).eq("status", "active");
    if (docError) throw docError;
    const targetId = crypto.randomUUID(); const storage = createPrivateStorageAdapter(admin);
    const eligible = (docs || []).filter((d: any) => !excluded.has(String(d.document_type || "").toLowerCase()));
    const copiedObjects = await copyObjectsWithCompensation(storage, eligible.map((d: any) => ({ bucket: d.storage_bucket, sourcePath: d.storage_key, destinationPath: safeObjectKey([po.organization_id,"purchase-orders",targetId,"supporting",d.original_file_name]), originalFileName: d.original_file_name, mimeType: d.mime_type, sizeBytes: d.size_bytes })));
    copied.push(...copiedObjects.map((o) => ({ bucket: o.bucket, key: o.key })));
    const metadata = copiedObjects.map((o, i) => ({ ...o, source_document_id: eligible[i].id, original_file_name: eligible[i].original_file_name || o.originalFileName, storage_provider: o.provider, storage_key: o.key, document_type: eligible[i].document_type, sort_order: eligible[i].sort_order }));
    const result = await admin.rpc("create_procurement_purchase_order_revision_atomic", { p_source_purchase_order_id: id, p_target_purchase_order_id: targetId, p_organization_id: po.organization_id, p_documents: metadata, p_actor: actor(auth) });
    if (result.error) throw result.error;
    return NextResponse.json(result.data, { status: 201 });
  } catch (error: any) {
    for (const destination of copied.reverse()) { try { await createPrivateStorageAdapter(adminClient()).delete(destination); } catch {} }
    return jsonError(error.message || "Failed to create Purchase Order revision.", 500);
  }
}
