import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementAny } from "@/lib/serverProcurementAccess";
import { resolveCurrentOfficialPoArtifact } from "@/lib/procurement/poOfficialArtifact.server";
import { renderPurchaseOrderBasePdfFromProjection, type PurchaseOrderPdfProjection } from "@/lib/procurement/poPdfBaseGeneration.server";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";

const MODULE = "procurement_purchase_orders";
const allowed = new Set(["contact_person", "phone", "email", "designation", "reason", "idempotency_key", "expected_current_artifact_id", "expected_contact_person", "expected_phone", "expected_email", "expected_designation"]);
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const actor = (auth: any) => ({ user_id: auth.user.id, name: auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email || "User", email: auth.user.email || null });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  try {
    const auth = await requireProcurementAny(request, [{ moduleCode: MODULE, actionCode: "view" }, { moduleCode: MODULE, actionCode: "edit" }, { moduleCode: MODULE, actionCode: "approve" }]);
    if ("response" in auth) return auth.response;
    if (!(auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner") || (auth.roleCodes || []).includes("super_admin"))) return jsonError("Only Super Admin or Platform Owner can perform an administrative correction.", 403);
    const supplied = Object.keys(body || {});
    if (supplied.some((key) => !allowed.has(key))) return jsonError("Administrative correction request contains unsupported fields.", 400);
    const reason = String(body.reason || "").trim();
    if (!reason) return jsonError("Correction reason is required.", 400);
    for (const field of ["contact_person", "phone", "email", "designation"]) if (typeof body[field] !== "string") return jsonError(`Corrected ${field} is required.`, 400);
    const idempotencyKey = String(body.idempotency_key || "");
    if (!idempotencyKey) return jsonError("Idempotency key is required.", 400);
    const id = (await context.params).id;
    const admin = adminClient();
    const organizationId = auth.organizations?.[0];
    let completedQuery = admin.from("procurement_purchase_order_artifact_current").select("artifact_id,previous_artifact_id").eq("purchase_order_id", id).eq("idempotency_key", idempotencyKey);
    if (organizationId) completedQuery = completedQuery.eq("organization_id", organizationId);
    const completed = await completedQuery.maybeSingle();
    if (completed.error) throw completed.error;
    if (completed.data) return NextResponse.json({ purchase_order_id: id, artifact_id: completed.data.artifact_id, previous_artifact_id: completed.data.previous_artifact_id, idempotent: true });
    let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, company:companies!procurement_purchase_orders_company_id_fkey(company_name,company_code), site:sites(site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(event_type,actor_id,actor_name,actor_email,created_at)").eq("id", id).maybeSingle(), auth);
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Purchase Order was not found.", 404);
    const { data: po, error } = await query;
    if (error) throw error;
    if (!po) return jsonError("Purchase Order was not found.", 404);
    if (po.status !== "approved") return jsonError("Only approved Purchase Orders can be corrected.", 409);
    const current = await resolveCurrentOfficialPoArtifact(admin, { organizationId: po.organization_id, purchaseOrderId: po.id });
    if (!current) return jsonError("The approved Purchase Order has no authoritative archived artifact.", 409);
    if (body.expected_current_artifact_id && body.expected_current_artifact_id !== current.artifactId) return jsonError("The current official artifact has changed; reload and retry.", 409);
    if (body.expected_contact_person !== undefined && body.expected_contact_person !== (po.vendor_snapshot?.contact_person ?? null)) return jsonError("The vendor contact snapshot has changed; reload and retry.", 409);
    const projection: PurchaseOrderPdfProjection = structuredClone(po);
    const before = projection.vendor_snapshot || {};
    projection.vendor_snapshot = { ...before, contact_person: body.contact_person, phone: body.phone, email: body.email, designation: body.designation };
    if (JSON.stringify(projection.items) !== JSON.stringify(po.items) || projection.po_number !== po.po_number || projection.revision_no !== po.revision_no || projection.status !== po.status) throw new Error("Administrative correction changed protected PO fields.");
    const rendered = await renderPurchaseOrderBasePdfFromProjection(admin, projection);
    const bytes = Buffer.from(rendered.pdf);
    const artifactId = randomUUID();
    const storageKey = `${po.organization_id}/purchase-orders/${po.id}/corrections/${artifactId}/official-po.pdf`;
    const storage = createPrivateStorageAdapter(admin);
    const inserted = await admin.from("procurement_purchase_order_artifacts").insert({ id: artifactId, organization_id: po.organization_id, purchase_order_id: po.id, artifact_type: "official_po", artifact_status: "pending", archive_origin: "administrative_correction", storage_provider: "supabase", storage_bucket: "procurement-rfq-quotation-documents", storage_key: storageKey, generated_by: auth.user.id, sha256: digest(bytes), size_bytes: bytes.byteLength, page_count: rendered.pageCount, footer_rendered_height: rendered.footerRenderedHeight, generated_at: new Date().toISOString() }).select("id").single();
    if (inserted.error) throw inserted.error;
    try {
      await storage.upload({ bucket: "procurement-rfq-quotation-documents", key: storageKey, file: new File([bytes], "official-po.pdf", { type: "application/pdf" }), checksum: digest(bytes) });
      const verified = await admin.storage.from("procurement-rfq-quotation-documents").download(storageKey);
      if (verified.error || !verified.data) throw verified.error || new Error("Correction PDF verification failed.");
      const verifiedBytes = Buffer.from(await verified.data.arrayBuffer());
      if (verifiedBytes.byteLength !== bytes.byteLength || digest(verifiedBytes) !== digest(bytes)) throw new Error("Correction PDF hash/size verification failed.");
      const archived = await admin.from("procurement_purchase_order_artifacts").update({ artifact_status: "archived", archived_at: new Date().toISOString() }).eq("id", artifactId).eq("artifact_status", "pending").select("id").single();
      if (archived.error) throw archived.error;
      const result = await admin.rpc("finalize_procurement_po_vendor_contact_correction", { p_organization_id: po.organization_id, p_purchase_order_id: po.id, p_new_artifact_id: artifactId, p_expected_previous_artifact_id: current.artifactId, p_expected_contact_person: body.expected_contact_person ?? before.contact_person ?? null, p_expected_phone: body.expected_phone ?? before.phone ?? null, p_expected_email: body.expected_email ?? before.email ?? null, p_expected_designation: body.expected_designation ?? before.designation ?? null, p_contact_person: body.contact_person, p_phone: body.phone, p_email: body.email, p_designation: body.designation, p_reason: reason, p_actor: actor(auth), p_idempotency_key: idempotencyKey });
      if (result.error) throw result.error;
      return NextResponse.json({ ...result.data, idempotent: result.data?.idempotent === true });
    } catch (error) {
      console.error("Administrative PO correction failed after staging", { purchaseOrderId: po.id, artifactId, error });
      throw error;
    }
  } catch (error: any) { return jsonError(error?.message || "Administrative Purchase Order correction failed.", 400); }
}
