import { PDFDocument } from "pdf-lib";
import { adminClient } from "@/lib/serverProcurementAccess";
import { getEmployeeSignatureBlock } from "@/lib/hr/employeeSignature";
import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf, structuredTermsFromSnapshot } from "@/lib/workOrderPdfRenderer.server";
import { appendWorkOrderSupportingPdfs } from "@/lib/workOrderSupportingDocuments.server";
import { addWorkOrderDraftWatermark, addWorkOrderPackagePageNumbers } from "@/lib/workOrderPdfPackage.server";

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
    admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number,wo_date,wo_type,status,approval_status,created_by,created_by_name,created_by_email,created_at,approved_by,approved_by_name,approved_by_email,approved_at,total_basic_amount,total_gst_amount,total_amount,standard_terms_snapshot,work_order_key_terms,letterhead_snapshot,delivery_snapshot,creation_request_id").eq("id", id).maybeSingle(),
    admin.from("work_order_items").select("item_header_snapshot,description_snapshot,additional_description_snapshot,unit_snapshot,mode_of_measurement_snapshot,quantity,unit_rate,gst_percent,basic_amount,gst_amount,line_total,sort_order").eq("work_order_id", id).order("sort_order"),
    admin.from("work_order_documents").select("id,file_name,file_url,file_path,uploaded_at,drive_sync_key").eq("work_order_id", id).order("uploaded_at", { ascending: true }),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (linesResult.error) throw linesResult.error;
  if (documentsResult.error) throw documentsResult.error;
  const order = orderResult.data;
  if (!order) throw new Error("Work Order was not found.");
  const reviewedDocument = (documentsResult.data || []).find((row: any) => row.drive_sync_key === "pilot-reviewed-pdf");
  if (reviewedDocument) {
    const path = value(reviewedDocument.file_path);
    if (!path || path.startsWith("https://")) throw new Error("The reviewed Work Order PDF artifact is not available from private Work Order storage.");
    const downloaded = await admin.storage.from("work-order-documents").download(path.replace(/^\/+/, ""));
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("The reviewed Work Order PDF artifact could not be downloaded.");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() < 1) throw new Error("The reviewed Work Order PDF artifact has no pages.");
    return bytes;
  }
  if (order.creation_request_id) throw new Error("The reviewed Work Order PDF artifact is missing; refusing to regenerate a different package.");
  const companyResult = await admin.from("companies").select("id,organization_id,company_name,status").eq("id", order.company_id).eq("organization_id", order.organization_id).eq("status", "active").maybeSingle();
  if (companyResult.error) throw companyResult.error;

  const approvalEventResult = await admin.from("erp_audit_logs").select("created_by,created_by_name,created_by_email,created_at").eq("module_code", "work_orders").eq("entity_type", "work_order").eq("record_id", id).in("action", ["approve", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (approvalEventResult.error) throw approvalEventResult.error;
  const approvalEvent = approvalEventResult.data;
  const approverId = order.approved_by || approvalEvent?.created_by || null;
  const approvalSignature = ["approved", "issued"].includes(String(order.approval_status || order.status || "").toLowerCase())
    ? await loadApprovalSignature(admin, approverId)
    : { block: null, asset: null };
  const delivery = order.delivery_snapshot || {};
  const company = { company_name: delivery.gst_billing?.legal_name || delivery.gst_billing?.trade_name || companyResult.data?.company_name || "" };
  const vendorSnapshot = delivery.vendor_snapshot || {};
  const primaryVendorContact = (vendorSnapshot.contacts || []).find((contact: any) => contact?.is_primary) || (vendorSnapshot.contacts || [])[0] || {};
  const resolvedVendorSnapshot = { ...vendorSnapshot, contact_person: vendorSnapshot.contact_person || vendorSnapshot.contact_name || primaryVendorContact.contact_name || "", phone: vendorSnapshot.phone || vendorSnapshot.mobile || primaryVendorContact.contact_number || primaryVendorContact.mobile || "", email: vendorSnapshot.email || primaryVendorContact.email || "" };
  const standardTermsClauses = structuredTermsFromSnapshot(order.standard_terms_snapshot);
  const site = { site_name: delivery.delivery_location?.location_name || "" };
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
  const protectedPdf = ["approved", "issued"].includes(String(order.approval_status || order.status || "").toLowerCase())
    ? bytes
    : await addWorkOrderDraftWatermark(bytes);
  const supportingFiles: File[] = [];
  for (const document of (documentsResult.data || []).filter((row: any) => row.drive_sync_key !== "pilot-generated-pdf")) {
    const path = value(document.file_path);
    if (!path || path.startsWith("https://drive.google.com/") || path.startsWith("https://docs.google.com/")) throw new Error(`Supporting document ${value(document.file_name) || document.id} is not available from Work Order storage for review.`);
    const downloaded = await admin.storage.from("work-order-documents").download(path.replace(/^\/+/, ""));
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error(`Supporting document ${value(document.file_name) || document.id} could not be downloaded for review.`);
    const fileName = value(document.file_name) || "supporting-document";
    const lower = fileName.toLowerCase();
    const mimeType = lower.endsWith(".pdf") ? "application/pdf" : lower.endsWith(".png") ? "image/png" : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream";
    supportingFiles.push(new File([await downloaded.data.arrayBuffer()], fileName, { type: mimeType }));
  }
  const packagedPdf = supportingFiles.length ? await appendWorkOrderSupportingPdfs(protectedPdf, supportingFiles) : protectedPdf;
  return addWorkOrderPackagePageNumbers(packagedPdf);
}

export function workOrderPdfFileName(woNumber: unknown) {
  return `${value(woNumber) || "work-order"}.pdf`;
}
