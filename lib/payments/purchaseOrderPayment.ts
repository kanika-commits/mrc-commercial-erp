import { latestEffectiveByFamily } from "@/lib/procurement/poRevisionEffective";

export type PaymentPurchaseOrder = {
  id: string;
  organization_id: string;
  company_id: string;
  site_id: string;
  vendor_id: string | null;
  po_number: string;
  vendor_name_snapshot?: string | null;
  status: string;
  revision_family_id?: string | null;
  revision_no?: number | null;
  superseded_by_revision_id?: string | null;
  created_at?: string | null;
};

/** Reuses the established PO family ordering. Callers pass only approved/issued,
 * non-superseded rows, matching the effective-revision RPC's candidate rule.
 */
export function selectEffectivePayablePurchaseOrders<T extends PaymentPurchaseOrder>(rows: T[]) {
  const candidates = rows.filter((row) =>
    ["approved", "issued"].includes(String(row.status || "").toLowerCase()) &&
    !row.superseded_by_revision_id,
  );

  return (latestEffectiveByFamily(candidates) as T[])
    .filter(Boolean)
    .sort((a, b) => String(a.po_number || "").localeCompare(String(b.po_number || "")));
}

export type SiteQubePaymentSelection = {
  purchase_order_id: string;
  company_id: string;
  site_id: string;
  vendor_id: string;
  reference_number: string;
};

export function validateSiteQubePaymentSelection(
  submitted: SiteQubePaymentSelection,
  canonical: PaymentPurchaseOrder | null,
) {
  if (!canonical || submitted.purchase_order_id !== canonical.id) {
    return "The selected Purchase Order is no longer the current payable revision.";
  }
  if (!["approved", "issued"].includes(String(canonical.status || "").toLowerCase()) || canonical.superseded_by_revision_id) {
    return "Only the current approved or issued Purchase Order revision can receive a payment.";
  }
  if (submitted.company_id !== canonical.company_id) return "Company does not match the selected Purchase Order.";
  if (submitted.site_id !== canonical.site_id) return "Site / Project does not match the selected Purchase Order.";
  if (!canonical.vendor_id || submitted.vendor_id !== canonical.vendor_id) return "Vendor does not match the selected Purchase Order.";
  if (submitted.reference_number.trim() !== canonical.po_number) return "PO reference does not match the selected Purchase Order.";
  return null;
}

export function validateManualPurchaseOrderSelection(input: {
  company_id: string;
  site_id: string;
  vendor_id: string;
  reference_number: string;
  purchase_order_id: string;
}) {
  if (!input.company_id) return "Company is required for a Manual / Old PO payment.";
  if (!input.site_id) return "Site / Project is required for a Manual / Old PO payment.";
  if (!input.vendor_id) return "Vendor is required for a Manual / Old PO payment.";
  if (!input.reference_number.trim()) return "Manual PO Number / Reference is required.";
  if (input.purchase_order_id) return "Manual / Old PO payments cannot link to a SiteQube Purchase Order.";
  return null;
}

export function paymentPurchaseOrderLabel(po: {
  po_number: string;
  vendor_name?: string | null;
  site_name?: string | null;
}) {
  return [po.po_number, po.vendor_name, po.site_name].filter(Boolean).join(" — ");
}
