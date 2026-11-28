import { PDFDocument } from "pdf-lib";
import { adminClient } from "@/lib/serverProcurementAccess";
import { getEmployeeSignatureBlock } from "@/lib/hr/employeeSignature";
import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf, structuredTermsFromSnapshot } from "@/lib/workOrderPdfRenderer.server";
import { addWorkOrderDraftWatermark, addWorkOrderPackagePageNumbers } from "@/lib/workOrderPdfPackage.server";
import { appendWorkOrderSupportingPdfs } from "@/lib/workOrderSupportingDocuments.server";

const value = (input: unknown) => String(input ?? "").trim();

async function loadApprovalSignature(admin: ReturnType<typeof adminClient>, userId: string | null) {
  if (!userId) return { block: null, asset: null };
  const block = await getEmployeeSignatureBlock(admin, { userId, includeSignedUrl: false });
  if (!block?.storageBucket || !block.storageKey) return { block, asset: null };
  const downloaded = await admin.storage.from(block.storageBucket).download(block.storageKey);
  if (downloaded.error || !downloaded.data) return { block, asset: null };
  const source = Buffer.from(await downloaded.data.arrayBuffer());
  try {
    const probe = await PDFDocument.create();
    if (source.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      const image = await probe.embedJpg(source);
      return { block, asset: { data: source, width: image.width, height: image.height, format: "jpeg" as const } };
    }
    const image = await probe.embedPng(source);
    return { block, asset: { data: source, width: image.width, height: image.height, format: "png" as const } };
  } catch {
    return { block, asset: null };
  }
}

export async function renderApprovedWorkOrderPdfById(
  admin: ReturnType<typeof adminClient>,
  id: string,
) {
  const [orderResult, linesResult, documentsResult] = await Promise.all([
    admin.from("work_orders").select("id,organization_id,company_id,site_id,pilot_vendor_id,wo_number,wo_date,wo_type,status,approval_status,created_by,created_by_name,created_by_email,created_at,approved_by,approved_by_name,approved_by_email,approved_at,total_basic_amount,total_gst_amount,total_amount,standard_terms_snapshot,work_order_key_terms,letterhead_snapshot,delivery_snapshot,creation_request_id").eq("id", id).maybeSingle(),
    admin.from("work_order_items").select("item_header_snapshot,description_snapshot,additional_description_snapshot,unit_snapshot,mode_of_measurement_snapshot,quantity,unit_rate,gst_percent,basic_amount,gst_amount,line_total,sort_order").eq("work_order_id", id).order("sort_order"),
    admin.from("work_order_documents").select("id,file_name,file_url,file_path,uploaded_at,drive_sync_key").eq("work_order_id", id).order("uploaded_at", { ascending: true }),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (linesResult.error) throw linesResult.error;
  if (documentsResult.error) throw documentsResult.error;
  const order = orderResult.data;
  if (!order) throw new Error("Work Order was not found.");
  const companyResult = await admin.from("companies").select("id,organization_id,company_name,status").eq("id", order.company_id).eq("organization_id", order.organization_id).eq("status", "active").maybeSingle();
  if (companyResult.error) throw companyResult.error;

  const approvalEventResult = await admin.from("erp_audit_logs").select("created_by,created_by_name,created_by_email,created_at").eq("module_code", "work_orders").eq("entity_type", "work_order").eq("record_id", id).in("action", ["approve", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (approvalEventResult.error) throw approvalEventResult.error;
  const approvalEvent = approvalEventResult.data;
  const approverId = order.approved_by || approvalEvent?.created_by || null;
  const approvalSignature = ["approved", "issued"].includes(String(order.approval_status || order.status || "").toLowerCase())
    ? await loadApprovalSignature(admin, approverId)
    : { block: null, asset: null };
  if (["approved", "issued"].includes(String(order.approval_status || order.status || "").toLowerCase()) && (!approvalSignature.block?.storageBucket || !approvalSignature.block.storageKey || !approvalSignature.asset)) {
    throw new Error("Approved Work Order cannot be filed as signed: the approver has no configured usable signature asset.");
  }
  const delivery = order.delivery_snapshot || {};
  const selection = delivery.master_selection || {};
  const vendorId = delivery.vendor_snapshot?.vendor_id || order.pilot_vendor_id || null;
  const [vendorResult, vendorContactsResult, gstResult, billingResult, deliveryResult, siteResult] = await Promise.all([
    vendorId ? admin.from("vendors").select("id,vendor_name,address,gstin,pan").eq("id", vendorId).eq("organization_id", order.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    vendorId ? admin.from("vendor_contacts").select("id,contact_name,contact_number,email,designation,is_primary").eq("vendor_id", vendorId).eq("organization_id", order.organization_id).order("is_primary", { ascending: false }).order("created_at") : Promise.resolve({ data: [], error: null }),
    selection.gst_registration_id ? admin.from("company_gst_registrations").select("id,gstin,legal_name,trade_name,state,state_code,registration_type").eq("id", selection.gst_registration_id).eq("organization_id", order.organization_id).eq("company_id", order.company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    selection.billing_address_id ? admin.from("company_billing_addresses").select("id,gstin,address_line1,address_line2,city,state,pincode,contact_name,mobile,email").eq("id", selection.billing_address_id).eq("organization_id", order.organization_id).eq("company_id", order.company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    selection.delivery_location_id ? admin.from("site_delivery_locations").select("id,location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", selection.delivery_location_id).eq("organization_id", order.organization_id).eq("company_id", order.company_id).eq("site_id", order.site_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    admin.from("sites").select("id,site_name").eq("id", order.site_id).eq("organization_id", order.organization_id).maybeSingle(),
  ]);
  if (vendorResult.error || vendorContactsResult.error || gstResult.error || billingResult.error || deliveryResult.error || siteResult.error) throw vendorResult.error || vendorContactsResult.error || gstResult.error || billingResult.error || deliveryResult.error || siteResult.error;
  const vendorSnapshot = { ...(delivery.vendor_snapshot || {}), ...(vendorResult.data || {}) };
  const primaryVendorContact = (vendorContactsResult.data || []).find((contact: any) => contact?.is_primary) || (vendorContactsResult.data || [])[0] || {};
  const snapshotBilling = { ...(delivery.gst_billing || {}), ...(delivery.billing_address || {}) };
  const snapshotDelivery = { ...(delivery.delivery_location || {}) };
  const resolvedBilling = { ...snapshotBilling, ...(gstResult.data || {}), ...(billingResult.data || {}) };
  const resolvedDelivery = { ...snapshotDelivery, ...(deliveryResult.data || {}) };
  const company = { company_name: companyResult.data?.company_name || resolvedBilling.legal_name || resolvedBilling.trade_name || "" };
  const resolvedVendorSnapshot = {
    ...vendorSnapshot,
    contact_person: vendorSnapshot.contact_person || vendorSnapshot.contact_name || primaryVendorContact.contact_name || "",
    phone: vendorSnapshot.phone || vendorSnapshot.mobile || primaryVendorContact.contact_number || "",
    email: vendorSnapshot.email || primaryVendorContact.email || "",
  };
  const standardTermsClauses = structuredTermsFromSnapshot(order.standard_terms_snapshot);
  const site = { site_name: siteResult.data?.site_name || "" };
  const bytes = await renderWorkOrderPdf({
    ...order,
    approved_by: approverId,
    approved_by_name: order.approved_by_name || approvalEvent?.created_by_name,
    approved_by_email: order.approved_by_email || approvalEvent?.created_by_email,
    approved_at: order.approved_at || approvalEvent?.created_at,
    approval_signature_block: approvalSignature.block,
    approval_signature_asset: approvalSignature.asset,
    company,
    site,
    vendor_snapshot: resolvedVendorSnapshot,
    delivery_snapshot: { ...delivery, gst_billing: resolvedBilling, billing_address: resolvedBilling, delivery_location: resolvedDelivery, billing_contact: delivery.billing_contact || billingResult.data || {}, delivery_contact: delivery.delivery_contact || deliveryResult.data || {} },
    standard_terms_clauses: standardTermsClauses || undefined,
    items: (linesResult.data || []).map((item: any) => ({
      ...item,
      item_name_snapshot: item.item_header_snapshot,
      specification_snapshot: item.description_snapshot,
      make_snapshot: item.mode_of_measurement_snapshot,
      uom_snapshot: item.unit_snapshot,
      gst_rate: item.gst_percent,
      total_amount: item.line_total,
    })),
  }, await loadWorkOrderLetterheadAssets(order.letterhead_snapshot, order.letterhead_snapshot?.letterhead_id, order.company_id));
  const supportingFiles: File[] = [];
  for (const document of (documentsResult.data || []).filter((row: any) => !["pilot-generated-pdf", "pilot-reviewed-pdf"].includes(row.drive_sync_key))) {
    const path = value(document.file_path);
    if (!path || path.startsWith("https://drive.google.com/") || path.startsWith("https://docs.google.com/")) {
      throw new Error(`Supporting document ${value(document.file_name) || document.id} is not available from Work Order storage for review.`);
    }
    const downloaded = await admin.storage.from("work-order-documents").download(path.replace(/^\/+/, ""));
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error(`Supporting document ${value(document.file_name) || document.id} could not be downloaded for review.`);
    const fileName = value(document.file_name) || "supporting-document";
    const lower = fileName.toLowerCase();
    const mimeType = lower.endsWith(".pdf") ? "application/pdf" : lower.endsWith(".png") ? "image/png" : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream";
    supportingFiles.push(new File([await downloaded.data.arrayBuffer()], fileName, { type: mimeType }));
  }
  const packagedPdf = supportingFiles.length ? await appendWorkOrderSupportingPdfs(bytes, supportingFiles) : bytes;
  const protectedPdf = ["approved", "issued"].includes(String(order.approval_status || order.status || "").toLowerCase())
    ? packagedPdf
    : await addWorkOrderDraftWatermark(packagedPdf);
  return addWorkOrderPackagePageNumbers(protectedPdf);
}

export function workOrderPdfFileName(woNumber: unknown) {
  return `${value(woNumber) || "work-order"}.pdf`;
}
