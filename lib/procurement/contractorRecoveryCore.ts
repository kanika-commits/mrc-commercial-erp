export const RECOVERY_PURPOSE = "Recover from contractor";

export function validateRecovery(purposeValue: unknown, workOrderIdValue: unknown) {
  const rawPurpose = String(purposeValue ?? "").trim() || "General Purchase";
  const purpose = rawPurpose === "Standard" ? "General Purchase" : rawPurpose;
  const workOrderId = String(workOrderIdValue ?? "").trim();
  if (!["General Purchase", "Asset Purchase", RECOVERY_PURPOSE].includes(purpose)) throw new Error("Purchase Order purpose is invalid.");
  if (purpose === RECOVERY_PURPOSE && !workOrderId) throw new Error("A linked Work Order is required for contractor recovery Purchase Orders.");
  return { purpose, workOrderId: purpose === RECOVERY_PURPOSE ? workOrderId : null };
}

export function recoveryDraftPayload(po: any, workOrder: any, documents: any[], note: unknown, actor: any) {
  const basic = Number(po.total_basic_amount ?? 0);
  const gst = Number(po.total_gst_amount ?? po.gst_amount ?? 0);
  const total = Number(po.total_amount ?? po.grand_total ?? basic + gst);
  return { organization_id: po.organization_id, work_order_id: workOrder.id, source_purchase_order_id: po.id, source_purchase_order_documents: documents, vendor_id: po.vendor_id, debit_note_number: `DN-PO-${po.po_number}`, debit_note_date: new Date().toISOString().slice(0, 10), debit_note_type: "Contractor Recovery", reason: `Contractor recovery for Purchase Order ${po.po_number}. ${String(note ?? "").trim()}`.trim(), gross_amount: basic, gst_amount: gst, total_amount: total, status: "Draft", approval_status: "Pending", created_by_name: actor.name || actor.email, created_by_email: actor.email };
}

export async function ensureRecoveryDraft(deps: any, po: any, workOrder: any, documents: any[], note: unknown, actor: any) {
  const find = async () => {
    const result = await deps.db.findBySourcePurchaseOrder(po.organization_id, po.id);
    if (result.error) throw result.error;
    return result.data;
  };
  let draft = await find();
  if (!draft) {
    const inserted = await deps.db.insertDebitNote(recoveryDraftPayload(po, workOrder, documents, note, actor));
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    draft = inserted.data || await find();
  }
  if (!draft) throw new Error("Unable to create or reuse the contractor-recovery Debit Note draft.");
  const recipients = await deps.resolveRecipients({ organizationId: po.organization_id, companyId: workOrder.company_id, siteId: workOrder.site_id });
  for (const recipientUserId of recipients) await deps.insertNotification({ recipientUserId, debitNoteId: draft.id, organizationId: po.organization_id });
  return draft;
}

export function assertRecoveryApprovalAllowed(note: any, po: any) {
  if (note.source_purchase_order_id && (!po || po.id !== note.source_purchase_order_id || !["approved", "issued"].includes(String(po.status || "").toLowerCase()))) throw new Error("This contractor-recovery Debit Note cannot be approved until the linked Purchase Order is approved.");
  return true;
}

export function assertEditableRecoveryDraft(note: any, po: any, workOrder: any, patch: any) {
  if (!note || note.is_deleted || String(note.status || "").toLowerCase() !== "draft" || String(note.approval_status || "").toLowerCase() === "rejected") throw new Error("Only active contractor-recovery Debit Note drafts are editable.");
  if (!note.source_purchase_order_id || !po || po.id !== note.source_purchase_order_id || po.purpose !== RECOVERY_PURPOSE || po.recovery_work_order_id !== note.work_order_id) throw new Error("The Debit Note source Purchase Order linkage is invalid.");
  if (!workOrder || workOrder.id !== note.work_order_id || workOrder.organization_id !== po.organization_id || workOrder.company_id !== po.company_id || workOrder.site_id !== po.site_id) throw new Error("The linked Work Order is outside the Purchase Order scope.");
  const allowed = { debit_note_number: patch.debit_note_number, debit_note_date: patch.debit_note_date, debit_note_type: patch.debit_note_type, reason: patch.reason };
  return Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
}

export function manifestAllows(manifest: any[], document: any, note: any, po: any, workOrder: any) {
  return Boolean(note.source_purchase_order_id === po.id && note.work_order_id === workOrder.id && po.organization_id === note.organization_id && po.company_id === workOrder.company_id && po.site_id === workOrder.site_id && manifest.some((entry: any) => String(entry.document_id || entry.id) === String(document.id)));
}
