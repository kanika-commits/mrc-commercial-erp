import { PAGE_W, PAGE_H, type ImageAsset, makePdf, firstDisplayValue, cleanDisplay } from "@/lib/procurement/poPdfRenderer.server";
import { formatPoGenerationTime } from "@/lib/procurement/poGenerationTime";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { getEmployeeSignatureBlock } from "@/lib/hr/employeeSignature";
import { buildPurchaseOrderRevisionComparison } from "@/lib/procurement/poRevisionComparison";
import { buildPurchaseOrderRevisionPdfRenderModel } from "@/lib/procurement/poRevisionPdfRenderer";
import { resolveDraftPoMasterView } from "@/lib/procurement/poDraftMasterView.server";

async function loadSharp() {
  const module = await import("sharp");
  return module.default;
}

function imageDimensions(sourceBuffer: Buffer) {
  if (sourceBuffer.length >= 24 && sourceBuffer.readUInt32BE(0) === 0x89504e47 && sourceBuffer.readUInt32BE(4) === 0x0d0a1a0a) return { width: sourceBuffer.readUInt32BE(16), height: sourceBuffer.readUInt32BE(20) };
  return { width: PAGE_W, height: PAGE_H };
}

function detectedImageFormat(sourceBuffer: Buffer): "png" | "jpeg" | null {
  if (sourceBuffer.length >= 8 && sourceBuffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (sourceBuffer.length >= 3 && sourceBuffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "jpeg";
  return null;
}

async function imageAsset(name: string, file: string, cropHeight?: number) {
  const sharp = await loadSharp();
  const sourceBuffer = await fs.readFile(path.join(process.cwd(), "public", "letterheads", file));
  const metadata = await sharp(sourceBuffer).metadata();
  const scaledHeight = metadata.width && metadata.height ? Math.floor(metadata.height * PAGE_W / metadata.width) : PAGE_H;
  const safeCropHeight = cropHeight ? Math.min(cropHeight, Math.max(1, scaledHeight)) : undefined;
  let image = sharp(sourceBuffer).resize({ width: PAGE_W, withoutEnlargement: false });
  if (safeCropHeight) image = image.extract({ left: 0, top: 0, width: PAGE_W, height: safeCropHeight });
  const data = await image.jpeg({ quality: 92 }).toBuffer();
  return { name, data, width: PAGE_W, height: safeCropHeight || PAGE_H, format: "jpeg" } satisfies ImageAsset;
}

async function storageImageAsset(name: string, sourceBuffer: Buffer, cropHeight?: number) {
  const metadata = imageDimensions(sourceBuffer);
  const scaledHeight = Math.floor(metadata.height * PAGE_W / Math.max(1, metadata.width));
  const safeCropHeight = cropHeight ? Math.min(cropHeight, Math.max(1, scaledHeight)) : undefined;
  return { name, data: sourceBuffer, width: PAGE_W, height: safeCropHeight || scaledHeight, format: "png" } satisfies ImageAsset;
}

async function employeeSignatureImageAsset(admin: any, approverUserId: string | null | undefined, purchaseOrderId: string, signatureProfileId?: string | null) {
  if (!approverUserId) return { block: null, asset: null };
  const block = await getEmployeeSignatureBlock(admin, { userId: approverUserId, signatureProfileId, includeSignedUrl: false });
  if (!block?.storageBucket || !block.storageKey) return { block, asset: null };
  const downloaded = await admin.storage.from(block.storageBucket).download(block.storageKey);
  if (downloaded.error || !downloaded.data) return { block, asset: null };
  let detectedFormat: "png" | "jpeg" | null = null;
  let failureStage = "download";
  try {
    const source = Buffer.from(await downloaded.data.arrayBuffer());
    detectedFormat = detectedImageFormat(source);
    if (detectedFormat === "png" || detectedFormat === "jpeg") {
      const metadata = await (detectedFormat === "png" ? PDFDocument.create().then((pdf) => pdf.embedPng(source)) : PDFDocument.create().then((pdf) => pdf.embedJpg(source)));
      return { block, asset: { name: "approverSignature", data: source, width: metadata.width, height: metadata.height, format: detectedFormat } satisfies ImageAsset };
    }
    failureStage = "sharp-fallback";
    const sharp = await loadSharp();
    const data = await sharp(source).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
    const metadata = await sharp(data).metadata();
    return { block, asset: { name: "approverSignature", data, width: metadata.width || 150, height: metadata.height || 50, format: "jpeg" } satisfies ImageAsset };
  } catch (error: any) {
    console.warn("Approver signature image omitted", { purchaseOrderId, employeeId: block.employeeId, detectedFormat, failureStage, reason: error?.message || "signature preparation failed" });
    return { block, asset: null };
  }
}

async function makeLetterhead(row: any, admin: any) {
  const frozen = row.delivery_snapshot?.letterhead || null;
  if (frozen?.header_storage_bucket && frozen?.header_storage_key && frozen?.footer_storage_bucket && frozen?.footer_storage_key) {
    const [headerResult, footerResult] = await Promise.all([admin.storage.from(frozen.header_storage_bucket).download(frozen.header_storage_key), admin.storage.from(frozen.footer_storage_bucket).download(frozen.footer_storage_key)]);
    if (headerResult.error || !headerResult.data || footerResult.error || !footerResult.data) throw new Error("Frozen Purchase Order letterhead assets could not be downloaded.");
    const header = await storageImageAsset("frozenHeader", Buffer.from(await headerResult.data.arrayBuffer()), Number(frozen.header_height_points || 150));
    const footer = await storageImageAsset("frozenFooter", Buffer.from(await footerResult.data.arrayBuffer()), Number(frozen.footer_height_points || 66));
    return { header, footer, fullPage: false };
  }
  const identity = `${row.company?.company_code || ""} ${row.company?.company_name || ""}`.toLowerCase();
  if (identity.includes("tech") || identity.includes("mrc-tech")) return { header: await imageAsset("techHeader", "mrc-tech-header.png", 150), footer: await imageAsset("techFooter", "mrc-tech-footer.png", 66), fullPage: false };
  if (identity.includes("infracon") || identity.includes("mrc-infracon")) return { header: await imageAsset("infraconHeader", "mrc-infracon-header.png", 150), footer: await imageAsset("infraconFooter", "mrc-infracon-footer.png", 125), fullPage: false };
  return { header: null, footer: null, fullPage: false };
}

export async function renderPurchaseOrderBasePdf(admin: any, data: any, previousRevisionData: any = null) {
  data = await resolveDraftPoMasterView(admin, data);
  if (Number(data.revision_no || 0) > 0 && previousRevisionData) data.revisionComparison = buildPurchaseOrderRevisionComparison(previousRevisionData, data);
  const creatorResult = data.created_by ? await admin.from("hr_employees").select("employee_name,email,phone,personal_phone,company:companies(company_name),designation:hr_designations(designation_name)").eq("user_id", data.created_by).eq("organization_id", data.organization_id).eq("status", "active").maybeSingle() : { data: null, error: null };
  if (creatorResult.error) throw creatorResult.error;
  const revisionCreatedEvent = Number(data.revision_no || 0) > 0 && Array.isArray(data.events) ? data.events.filter((event: any) => event.event_type === "revision_created").sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))[0] : null;
  const preparedBy = { ...(creatorResult.data || {}), employee_name: creatorResult.data?.employee_name || data.created_by_name || revisionCreatedEvent?.actor_name || "", email: creatorResult.data?.email || data.created_by_email || revisionCreatedEvent?.actor_email || "" };
  const approvalEvent = Array.isArray(data.events) ? data.events.filter((event: any) => ["approve", "approved"].includes(event.event_type)).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0] : null;
  const approverId = approvalEvent?.actor_id || data.approved_by;
  const approverResult = approverId ? await admin.from("hr_employees").select("employee_name,email,phone,personal_phone,company:companies(company_name),designation:hr_designations(designation_name)").eq("user_id", approverId).eq("organization_id", data.organization_id).eq("status", "active").maybeSingle() : { data: null, error: null };
  if (approverResult.error) throw approverResult.error;
  const approverSignature = await employeeSignatureImageAsset(admin, approverId, data.id, data.approved_signature_profile_id);
  const revisionComparison = data.revisionComparison || null;
  const revisionPresentation = revisionComparison ? buildPurchaseOrderRevisionPdfRenderModel(data, revisionComparison) : null;
  const letterhead = await makeLetterhead(data, admin);
  const delivery = data.delivery_snapshot || {};
  const shipping = delivery.delivery_location || delivery.shipping_address || delivery;
  let deliveryCompany = firstDisplayValue(shipping.company_name);
  if (!deliveryCompany && cleanDisplay(shipping.company_id)) {
    const legacyCompany = await admin.from("companies").select("company_name").eq("id", shipping.company_id).eq("organization_id", data.organization_id).maybeSingle();
    if (legacyCompany.error) throw legacyCompany.error;
    deliveryCompany = firstDisplayValue(legacyCompany.data?.company_name);
  }
  const draftGeneratedAt = !["approved", "issued"].includes(data.status) ? formatPoGenerationTime(new Date()) : null;
  const poPackage = await makePdf(data, preparedBy, { ...approverResult.data, signatureBlock: approverSignature.block, signatureAsset: approverSignature.asset, employee_name: approverResult.data?.employee_name || approvalEvent?.actor_name || data.approved_by_name, approval_at: approvalEvent?.created_at || data.approved_at }, { letterhead, deliveryCompany }, revisionPresentation, draftGeneratedAt);
  return poPackage;
}

export async function renderApprovedPurchaseOrderBasePdf(admin: any, organizationId: string, purchaseOrderId: string) {
  const { data, error } = await admin.from("procurement_purchase_orders")
    .select("*, company:companies!procurement_purchase_orders_company_id_fkey(company_name,company_code), site:sites(site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(event_type,actor_id,actor_name,actor_email,created_at)")
    .eq("id", purchaseOrderId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  if (!data || !["approved", "issued"].includes(data.status)) throw new Error("Only an approved or issued Purchase Order revision can be archived.");
  let previousRevisionData: any = null;
  if (Number(data.revision_no || 0) > 0 && data.previous_revision_id) {
    const previousResult = await admin.from("procurement_purchase_orders").select("*, items:procurement_purchase_order_items(*)")
      .eq("id", data.previous_revision_id).eq("organization_id", organizationId).maybeSingle();
    if (previousResult.error) throw previousResult.error;
    if (!previousResult.data) throw new Error("Previous Purchase Order revision was not found.");
    previousRevisionData = previousResult.data;
  }
  const pdf = await renderPurchaseOrderBasePdf(admin, data, previousRevisionData);
  return { bytes: Buffer.from(pdf.pdf), pageCount: pdf.pageCount, footerRenderedHeight: pdf.footerRenderedHeight };
}
