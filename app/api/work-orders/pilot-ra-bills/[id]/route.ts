import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { calculatePilotRaBill } from "@/lib/workOrderPilotRaBill";
import { pilotRaBillReviewBindingHash } from "@/lib/workOrderPilotRaBillReviewBinding";
import { notifyPilotOverQuantityException } from "@/lib/pilotRaBillOverQuantityNotifications.server";
import { recordAuditEvent } from "@/lib/auditEvent";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function currentPilotAdjustments(admin: any, workOrderId: string, organizationId: string) {
  const [debit, credit] = await Promise.all([
    admin.from("debit_notes").select("total_amount,gross_amount").eq("organization_id", organizationId).eq("work_order_id", workOrderId).ilike("approval_status", "approved").ilike("status", "approved").eq("is_deleted", false),
    admin.from("credit_notes").select("total_amount,gross_amount").eq("organization_id", organizationId).eq("work_order_id", workOrderId).ilike("approval_status", "approved").ilike("status", "approved"),
  ]);
  if (debit.error) throw debit.error;
  if (credit.error) throw credit.error;
  return {
    total_debit_notes: (debit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0),
    total_credit_notes: (credit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0),
  };
}


export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const id = (await params).id;
    if (!isUuid(id)) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    let query = admin.from("work_order_pilot_ra_bills").select("*,work_order_pilot_ra_bill_items(*),work_order_pilot_ra_bill_reviewed_artifacts(id,sha256,byte_length,created_at)").eq("id", id);
    query = applyOrganizationScope(query, scope);
    if (!query) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data ? NextResponse.json({ bill: data }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not load bill." }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const id = (await params).id;
    if (!isUuid(id)) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "submit") return NextResponse.json({ error: "Unsupported Pilot RA Bill action." }, { status: 400 });
    let currentQuery = admin.from("work_order_pilot_ra_bills").select("id,organization_id,work_order_id,status,withheld,labour_cess,calculation_snapshot,over_quantity_allowance_percent,reviewed_pdf_sha256,reviewed_pdf_byte_length").eq("id", id);
    currentQuery = applyOrganizationScope(currentQuery, scope);
    if (!currentQuery) return NextResponse.json({ error: "Pilot RA Bill is outside your organization scope." }, { status: 404 });
    const current = await currentQuery.maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    if (!body.reviewed_pdf_sha256 || !Number.isInteger(Number(body.reviewed_pdf_byte_length)) || !body.reviewed_pdf_base64 || !body.reviewed_input_snapshot_sha256) return NextResponse.json({ error: "Submit the exact reviewed Pilot PDF artifact and input snapshot binding." }, { status: 422 });
    const artifact = Buffer.from(String(body.reviewed_pdf_base64), "base64");
    const actualHash = crypto.createHash("sha256").update(artifact).digest("hex");
    if (actualHash !== String(body.reviewed_pdf_sha256) || artifact.byteLength !== Number(body.reviewed_pdf_byte_length)) return NextResponse.json({ error: "The reviewed PDF hash or byte length does not match the submitted artifact." }, { status: 422 });
    if (current.data.status === "submitted" && current.data.reviewed_pdf_sha256 === actualHash) {
      return NextResponse.json({ bill: current.data, idempotent: true });
    }
    if (current.data.status !== "draft" && current.data.status !== "sent_back") return NextResponse.json({ error: "Only a draft or sent-back Pilot RA Bill can be submitted." }, { status: 409 });
    const adjustments = await currentPilotAdjustments(admin, current.data.work_order_id, current.data.organization_id);
    const savedCalculation = current.data.calculation_snapshot || {};
    if (Number(savedCalculation.total_debit_notes || 0) !== Number(adjustments.total_debit_notes) || Number(savedCalculation.total_credit_notes || 0) !== Number(adjustments.total_credit_notes)) {
      return NextResponse.json({ error: "Debit Note or Credit Note totals changed after preview. Review the Pilot RA Bill PDF again before submission." }, { status: 409 });
    }
    const workOrder = await admin.from("work_orders").select("gst_percent").eq("id", current.data.work_order_id).eq("organization_id", current.data.organization_id).maybeSingle();
    if (workOrder.error) throw workOrder.error;
    if (!workOrder.data) return NextResponse.json({ error: "Pilot Work Order is outside your organization scope." }, { status: 404 });
    const priorApproved = await admin.from("work_order_pilot_ra_bills").select("calculation_snapshot").eq("organization_id", current.data.organization_id).eq("work_order_id", current.data.work_order_id).eq("status", "approved").is("deleted_at", null).neq("id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (priorApproved.error) throw priorApproved.error;
    const authoritativePriorSecurity = Number(priorApproved.data?.calculation_snapshot?.cumulative_security || 0);
    const savedCurrentSecurity = savedCalculation.security_input_version === 2 ? Number(savedCalculation.current_security || 0) : Number(savedCalculation.cumulative_security || 0) - authoritativePriorSecurity;
    const recalculated = calculatePilotRaBill({ items: savedCalculation.items || [], gst_percent: Number(workOrder.data.gst_percent || 0), security_current: savedCurrentSecurity, withheld: Number(current.data.withheld || 0), labour_cess: Number(current.data.labour_cess || 0), ...adjustments, previous_basic: Number(savedCalculation.cumulative_basic || 0) - Number(savedCalculation.current_basic || 0), previous_gst: Number(savedCalculation.cumulative_gst || 0) - Number(savedCalculation.current_gst || 0), previous_security: authoritativePriorSecurity });
    if (recalculated.adjusted_net_payable < 0 || Number(recalculated.adjusted_net_payable) !== Number(savedCalculation.adjusted_net_payable || 0)) return NextResponse.json({ error: "Pilot RA Bill calculations changed after preview. Review the PDF again before submission." }, { status: 409 });
    const currentBinding = pilotRaBillReviewBindingHash({ billId: id, organizationId: current.data.organization_id, workOrderId: current.data.work_order_id, withheld: Number(current.data.withheld || 0), labourCess: Number(current.data.labour_cess || 0), calculationSnapshot: { ...savedCalculation, total_debit_notes: adjustments.total_debit_notes, total_credit_notes: adjustments.total_credit_notes, adjusted_net_payable: recalculated.adjusted_net_payable } });
    if (currentBinding !== String(body.reviewed_input_snapshot_sha256)) return NextResponse.json({ error: "Pilot RA Bill inputs changed after preview. Generate and review a fresh PDF before submission." }, { status: 409 });
    const attachments = await admin.from("work_order_pilot_ra_bill_attachments").select("id,organization_id,original_file_name,mime_type,size_bytes,storage_bucket,storage_key,sha256,status").eq("ra_bill_id", id).eq("organization_id", current.data.organization_id);
    if (attachments.error) throw attachments.error;
    const manifest = [];
    for (const attachment of attachments.data || []) {
      if (attachment.status !== "draft") throw new Error("Pilot attachment is no longer editable for submission.");
      const object = await admin.storage.from("work-order-pilot-ra-bill-attachments").download(attachment.storage_key);
      if (object.error || !object.data) throw new Error(`Pilot attachment ${attachment.original_file_name} is missing.`);
      const bytes = Buffer.from(await object.data.arrayBuffer());
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      if (hash !== attachment.sha256 || bytes.byteLength !== Number(attachment.size_bytes)) throw new Error(`Pilot attachment ${attachment.original_file_name} changed after upload.`);
      manifest.push({ id: attachment.id, file_name: attachment.original_file_name, mime_type: attachment.mime_type, byte_length: bytes.byteLength, sha256: hash, storage_bucket: "work-order-pilot-ra-bill-attachments", storage_key: attachment.storage_key });
    }
    const manifestHash = crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const submitted = await admin.rpc("submit_work_order_pilot_ra_bill_with_cycle", { p_id: id, p_pdf_bytes: artifact, p_pdf_sha256: actualHash, p_pdf_length: artifact.byteLength, p_manifest: manifest, p_manifest_sha256: manifestHash, p_actor: auth.user.id, p_reviewed_input_snapshot_sha256: String(body.reviewed_input_snapshot_sha256) });
    if (submitted.error) throw submitted.error;
    if (savedCalculation.over_quantity === true && Number(current.data.over_quantity_allowance_percent || 0) >= 0) {
      const notificationBill = { id, organization_id: current.data.organization_id, work_order_id: current.data.work_order_id, bill_number: current.data.id };
      await notifyPilotOverQuantityException(admin, notificationBill);
    }
    await recordAuditEvent(admin, auth.user, { organizationId: current.data.organization_id, moduleCode: "ra_bills", entityType: "pilot_ra_bill", recordId: id, action: "submit", actionCategory: "workflow", activityLabel: "Submitted Pilot RA Bill", description: "Submitted Pilot RA Bill for approval." }, request).catch(() => undefined);
    return NextResponse.json({ bill: submitted.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not update bill." }, { status: 400 }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit");
    if ("response" in auth) return auth.response;
    const admin = db();
    const scope = await loadActorOrganizationScope(admin, auth);
    const id = (await params).id;
    if (!isUuid(id)) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (!reason) return NextResponse.json({ error: "A deletion reason is required for a Pilot RA Bill." }, { status: 422 });
    if (!String(body.confirmation || "").trim() || !String(body.confirmation).includes(id)) return NextResponse.json({ error: "Confirm deletion with this Pilot RA Bill ID." }, { status: 422 });
    let query = admin.from("work_order_pilot_ra_bills").select("id,organization_id,bill_number,status,work_order:work_orders!inner(id,organization_id,creation_request_id)").eq("id", id).in("status", ["draft", "approved"]).not("work_order.creation_request_id", "is", null);
    query = applyOrganizationScope(query, scope);
    if (!query) return NextResponse.json({ error: "Pilot RA Bill is outside your organization scope." }, { status: 404 });
    const bill = await query.maybeSingle();
    if (bill.error) throw bill.error;
    const linkedDraftWorkOrder = Array.isArray(bill.data?.work_order) ? bill.data.work_order[0] : bill.data?.work_order;
    if (bill.data && linkedDraftWorkOrder?.organization_id !== bill.data.organization_id) return NextResponse.json({ error: "Pilot RA Bill is outside your organization scope." }, { status: 404 });
    if (!bill.data) {
      let retryAuditQuery = admin.from("work_order_pilot_ra_bill_deletion_audit")
        .select("id,organization_id,ra_bill_id,bill_number,cleanup_status,drive_cleanup,attachment_cleanup")
        .eq("ra_bill_id", id)
        .in("cleanup_status", ["db_deleted_external_pending", "complete"]);
      retryAuditQuery = applyOrganizationScope(retryAuditQuery, scope);
      if (!retryAuditQuery) return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
      const retryAudit = await retryAuditQuery.order("cleanup_updated_at", { ascending: false }).limit(1).maybeSingle();
      if (retryAudit.error) throw retryAudit.error;
      if (retryAudit.data) {
        return NextResponse.json({
          deleted: true,
          database_deleted: true,
          id,
          idempotent: true,
          cleanup_status: retryAudit.data.cleanup_status,
          external_cleanup_pending: retryAudit.data.cleanup_status !== "complete",
          message: "Pilot RA Bill database record was already deleted. Drive and Storage files may still need manual removal.",
        });
      }
      return NextResponse.json({ error: "Pilot RA Bill not found." }, { status: 404 });
    }
    const linkedWorkOrder = Array.isArray(bill.data.work_order) ? bill.data.work_order[0] : bill.data.work_order;
    if (linkedWorkOrder?.organization_id !== bill.data.organization_id) return NextResponse.json({ error: "Pilot RA Bill is outside your organization scope." }, { status: 404 });
    if (bill.data.status === "approved" && !auth.roleCodes.some((role) => ["platform_owner", "super_admin"].includes(role))) return NextResponse.json({ error: "Only a Platform Owner or Super Admin can delete an approved Pilot RA Bill." }, { status: 403 });
    const prepared = await admin.rpc("prepare_hard_delete_work_order_pilot_ra_bill", { p_id: id, p_actor: auth.user.id, p_reason: reason });
    if (prepared.error) throw new Error(`Pilot hard-delete prepare failed: ${prepared.error.message}`);
    const manifest = prepared.data || {};
    const auditId = String(manifest.audit_id || "");
    if (manifest.status === "complete") return NextResponse.json({ deleted: true, id, idempotent: true });
    let auditQuery = admin.from("work_order_pilot_ra_bill_deletion_audit").select("id,organization_id,cleanup_status,cleanup_error,attachment_cleanup,drive_cleanup").eq("id", auditId).eq("ra_bill_id", id).eq("organization_id", bill.data.organization_id).maybeSingle();
    const audit = await auditQuery;
    if (audit.error) throw new Error(`Pilot hard-delete cleanup state could not be read: ${audit.error.message}`);
    if (!audit.data) throw new Error("Pilot hard-delete cleanup state is missing; the bill was preserved and retry is safe.");
    const finalized = await admin.rpc("finalize_database_delete_pending_work_order_pilot_ra_bill", { p_id: id, p_audit_id: auditId });
    if (finalized.error) throw new Error(`Pilot hard-delete finalize failed: ${finalized.error.message}`);
    await recordAuditEvent(admin, auth.user, { organizationId: bill.data.organization_id, moduleCode: "ra_bills", entityType: "pilot_ra_bill", recordId: id, action: "delete", actionCategory: "delete", activityLabel: "Deleted Pilot RA Bill", description: reason }, request).catch(() => undefined);
    return NextResponse.json({ ...finalized.data, id, message: "Pilot RA Bill database record was deleted. Drive and Storage files may still need manual removal." });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not delete Pilot RA Bill." }, { status: 400 }); }
}
