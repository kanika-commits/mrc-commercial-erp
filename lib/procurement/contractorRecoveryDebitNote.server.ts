export const CONTRACTOR_RECOVERY_PURPOSE = "Recover from contractor";
export const PURCHASE_ORDER_PURPOSES = new Set(["General Purchase", "Asset Purchase", CONTRACTOR_RECOVERY_PURPOSE]);

export function normalizePurchaseOrderPurpose(value: unknown) {
  const purpose = String(value ?? "").trim() || "General Purchase";
  return purpose === "Standard" ? "General Purchase" : purpose;
}

export function validatePurchaseOrderPurpose(purposeValue: unknown, recoveryWorkOrderId: unknown) {
  const purpose = normalizePurchaseOrderPurpose(purposeValue);
  if (!PURCHASE_ORDER_PURPOSES.has(purpose)) throw new Error("Purchase Order purpose is invalid.");
  const workOrderId = String(recoveryWorkOrderId ?? "").trim();
  if (purpose === CONTRACTOR_RECOVERY_PURPOSE && !workOrderId) throw new Error("A linked Work Order is required for contractor recovery Purchase Orders.");
  return { purpose, recoveryWorkOrderId: purpose === CONTRACTOR_RECOVERY_PURPOSE ? workOrderId : null };
}

export async function validateRecoveryWorkOrder(admin: any, organizationId: string, companyId: string, siteId: string, workOrderId: string, vendorId: string) {
  const result = await admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number").eq("id", workOrderId).eq("organization_id", organizationId).eq("company_id", companyId).eq("site_id", siteId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The recovery Work Order must match the Purchase Order organization, company and site.");
  const vendorLink = await admin.from("work_order_vendors").select("id,work_order_id,vendor_id,vendor_role,is_primary").eq("work_order_id", workOrderId).eq("vendor_id", vendorId).maybeSingle();
  if (vendorLink.error) throw vendorLink.error;
  if (!vendorLink.data || !["Main Contractor", "Subcontractor"].includes(String(vendorLink.data.vendor_role || ""))) throw new Error("The recovery Work Order must be linked to the selected Purchase Order vendor as a main contractor or subcontractor.");
  return { ...result.data, vendor_link: vendorLink.data };
}

export async function ensureContractorRecoveryDebitNote({ admin, po, auth, note, workOrder }: { admin: any; po: any; auth: any; note?: unknown; workOrder?: any }) {
  const normalized = validatePurchaseOrderPurpose(po.purpose || po.commercial_snapshot?.purpose, po.recovery_work_order_id || po.commercial_snapshot?.recovery_work_order_id);
  if (normalized.purpose !== CONTRACTOR_RECOVERY_PURPOSE) return null;
  const linkedWorkOrder = workOrder || await validateRecoveryWorkOrder(admin, po.organization_id, po.company_id, po.site_id, normalized.recoveryWorkOrderId!, po.vendor_id);
  const documents = await admin.from("procurement_purchase_order_documents").select("id,original_file_name,mime_type,size_bytes,storage_bucket,storage_key,document_type").eq("purchase_order_id", po.id).eq("organization_id", po.organization_id).eq("status", "active").order("sort_order");
  if (documents.error) throw documents.error;
  return ensureRecoveryDraft(
    {
      db: {
        findBySourcePurchaseOrder: async (organizationId: string, sourcePurchaseOrderId: string) => {
          const result = await admin.from("debit_notes").select("id,status,approval_status,source_purchase_order_id").eq("organization_id", organizationId).eq("source_purchase_order_id", sourcePurchaseOrderId).or("is_deleted.is.null,is_deleted.eq.false").neq("approval_status", "Rejected").maybeSingle();
          return result;
        },
        insertDebitNote: async (payload: any) => admin.from("debit_notes").insert(payload).select("id,status,approval_status,source_purchase_order_id").maybeSingle(),
      },
      resolveRecipients: async ({ organizationId, companyId, siteId }: any) => resolveNotificationRecipients(admin, { organizationId, companyId, siteId, moduleCode: "debit_notes", actionCode: "view" }),
      insertNotification: async ({ recipientUserId, debitNoteId, organizationId }: any) => insertNotificationOnce(admin, {
        organization_id: organizationId,
        recipient_user_id: recipientUserId,
        notification_type: "contractor_recovery_debit_note",
        title: "Contractor recovery Debit Note draft",
        message: `Debit Note draft for Purchase Order ${po.po_number} is ready for review.`,
        target_url: `/debit-notes/${debitNoteId}`,
        related_entity_type: "debit_note",
        related_entity_id: debitNoteId,
      }),
    },
    po,
    linkedWorkOrder,
    documents.data || [],
    note,
    { name: auth.user.user_metadata?.full_name || auth.user.email, email: auth.user.email },
  );
}
import { insertNotificationOnce, resolveNotificationRecipients } from "@/lib/serverNotificationRecipients";
import { ensureRecoveryDraft } from "@/lib/procurement/contractorRecoveryCore";
