import { PAGE_W, PAGE_H, PAGE_NUMBER_OFFSET, PAGE_NUMBER_SIZE, text } from "@/lib/procurement/poPdfRenderer.server";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { applyCompanySiteAccess, applyOrganizationAccess, adminClient, jsonError, requireProcurementAny } from "@/lib/serverProcurementAccess";
import { readVerifiedOfficialPo } from "@/lib/procurement/poOfficialArtifact.server";
import { renderPurchaseOrderBasePdf } from "@/lib/procurement/poPdfBaseGeneration.server";

const PACKAGE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const PACKAGE_LIMIT = 25 * 1024 * 1024;

async function loadSharp() {
  const module = await import("sharp");
  return module.default;
}

function imageDimensions(sourceBuffer: Buffer) {
  if (sourceBuffer.length >= 24 && sourceBuffer.readUInt32BE(0) === 0x89504e47 && sourceBuffer.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: sourceBuffer.readUInt32BE(16), height: sourceBuffer.readUInt32BE(20) };
  }
  return { width: PAGE_W, height: PAGE_H };
}

function logSkippedSupportingDocument(row: any, document: any, reason: string) {
  console.warn("Skipping unreadable supporting document", {
    purchaseOrderId: row.id,
    documentId: document.id || null,
    fileName: document.original_file_name || "unknown",
    reason,
  });
}

async function appendPackage(poPdf: Buffer, row: any, admin: any) {
  let query = admin.from("procurement_purchase_order_documents").select("id,original_file_name,mime_type,size_bytes,storage_provider,storage_bucket,storage_key,sort_order,created_at,status").eq("purchase_order_id", row.id).eq("organization_id", row.organization_id).eq("status", "active");
  const { data: documents, error } = await query;
  if (error) throw error;
  const manifest = Array.isArray(row.supporting_documents_manifest) ? row.supporting_documents_manifest : null;
  const selected = manifest ? manifest.map((entry: any) => documents?.find((document: any) => document.id === entry.document_id) || { ...entry, missing: true }) : (documents || []).sort((a: any, b: any) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  const eligible = selected.filter((document: any) => PACKAGE_MIMES.has(document.mime_type));
  const total = eligible.reduce((sum: number, document: any) => sum + Number(document.size_bytes || 0), 0);
  if (total > PACKAGE_LIMIT) throw new Error("The supporting-document package exceeds the 25 MB limit.");
  if (!eligible.length) return poPdf;
  const output = await PDFDocument.load(poPdf);
  for (const document of eligible) {
    if (document.missing) throw new Error(`Supporting document ${text(document.original_file_name)} is unavailable.`);
    const downloaded = await admin.storage.from(document.storage_bucket).download(document.storage_key);
    if (downloaded.error || !downloaded.data) throw new Error(`Supporting document ${text(document.original_file_name)} could not be downloaded.`);
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    try {
      if (document.mime_type === "application/pdf") {
        const source = await PDFDocument.load(bytes);
        const pages = await output.copyPages(source, source.getPageIndices());
        pages.forEach((page) => output.addPage(page));
      } else {
        let image = bytes;
        let metadata: { width?: number; height?: number };
        if (document.mime_type === "image/webp") {
          const sharp = await loadSharp();
          image = await sharp(bytes).png().toBuffer();
          metadata = await sharp(image).metadata();
        } else if (document.mime_type === "image/jpeg") {
          const embedded = await output.embedJpg(image);
          metadata = { width: embedded.width, height: embedded.height };
          const page = output.addPage([595, 842]);
          const scale = Math.min(535 / Math.max(1, metadata.width || 1), 782 / Math.max(1, metadata.height || 1));
          const width = (metadata.width || 1) * scale; const height = (metadata.height || 1) * scale;
          page.drawImage(embedded, { x: (595 - width) / 2, y: (842 - height) / 2, width, height });
          continue;
        } else {
          metadata = imageDimensions(image);
        }
        const embedded = await output.embedPng(image);
        const page = output.addPage([595, 842]);
        const scale = Math.min(535 / Math.max(1, metadata.width || 1), 782 / Math.max(1, metadata.height || 1));
        const width = (metadata.width || 1) * scale; const height = (metadata.height || 1) * scale;
        page.drawImage(embedded, { x: (595 - width) / 2, y: (842 - height) / 2, width, height });
      }
    } catch (error: any) {
      logSkippedSupportingDocument(row, document, error?.message || "decode or embed failed");
    }
  }
  return Buffer.from(await output.save());
}

async function watermarkDraftPackage(pdfBytes: Buffer) {
  const pdf = await PDFDocument.load(pdfBytes);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    page.drawText("DRAFT", {
      x: width * 0.16,
      y: height * 0.42,
      size: Math.min(width, height) * 0.16,
      rotate: degrees(35),
      color: rgb(0.65, 0.12, 0.12),
      opacity: 0.2,
    });
  }
  return Buffer.from(await pdf.save());
}

async function numberPackage(pdfBytes: Buffer, generatedPageCount: number, footerRenderedHeight: number) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont("Helvetica");
  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => {
    const label = `${index + 1} of ${pages.length}`;
    const width = font.widthOfTextAtSize(label, 8);
    const pageWidth = currentPage.getWidth();
    const pageHeight = currentPage.getHeight();
    const y = index < generatedPageCount && footerRenderedHeight > 0 ? footerRenderedHeight + PAGE_NUMBER_OFFSET : Math.max(24, Math.min(pageHeight - 24, pageHeight > 700 ? 140 : pageHeight * 0.12));
    currentPage.drawText(label, { x: pageWidth - 42 - width, y, size: PAGE_NUMBER_SIZE, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return Buffer.from(await pdf.save());
}
function clauseIdentity(clause: any) { return String(clause.id ?? clause.key ?? clause.code ?? clause.heading ?? clause.title ?? clause.label ?? `${clause.heading}|${clause.clause_body}`); }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const auth = await requireProcurementAny(request, [{ moduleCode: "procurement_purchase_orders", actionCode: "view" }, { moduleCode: "procurement_purchase_orders", actionCode: "edit" }, { moduleCode: "procurement_purchase_orders", actionCode: "approve" }]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, company:companies!procurement_purchase_orders_company_id_fkey(company_name,company_code), site:sites(site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(event_type,actor_id,actor_name,actor_email,created_at)").eq("id", id).maybeSingle(), auth);
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Purchase Order was not found.", 404);
    const { data, error } = await query;
    if (error) throw error;
    if (!data) return jsonError("Purchase Order was not found.", 404);
    let previousRevisionData: any = null;
    if (Number(data.revision_no || 0) > 0 && data.previous_revision_id) {
      const previousResult = await admin.from("procurement_purchase_orders").select("*, items:procurement_purchase_order_items(*)").eq("id", data.previous_revision_id).eq("organization_id", data.organization_id).maybeSingle();
      if (previousResult.error) throw previousResult.error;
      if (!previousResult.data) throw new Error("Previous Purchase Order revision was not found.");
      previousRevisionData = previousResult.data;
    }
    let poPackage: { pdf: Buffer; pageCount: number; footerRenderedHeight: number };
    let pdfSource: "archived" | "dynamic" = "dynamic";
    if (["approved", "issued"].includes(data.status)) {
      try {
        const archived = await readVerifiedOfficialPo(admin, { organizationId: data.organization_id, purchaseOrderId: data.id });
        if (archived) {
          poPackage = { pdf: archived.bytes, pageCount: archived.pageCount, footerRenderedHeight: archived.footerRenderedHeight };
          pdfSource = "archived";
        } else {
          poPackage = await renderPurchaseOrderBasePdf(admin, data, previousRevisionData);
        }
      } catch (archiveError) {
        console.error("Archived Purchase Order PDF unavailable; using dynamic fallback", { purchaseOrderId: data.id, error: archiveError });
        poPackage = await renderPurchaseOrderBasePdf(admin, data, previousRevisionData);
      }
    } else {
      poPackage = await renderPurchaseOrderBasePdf(admin, data, previousRevisionData);
    }
    const combinedPdf = await appendPackage(poPackage.pdf, data, admin);
    const protectedPdf = ["approved", "issued"].includes(data.status) ? combinedPdf : await watermarkDraftPackage(combinedPdf);
    const finalPdf = await numberPackage(protectedPdf, poPackage.pageCount, poPackage.footerRenderedHeight);
    return new NextResponse(new Uint8Array(finalPdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(data.po_number || "purchase-order").replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf"`, "Cache-Control": "private, no-store", "X-PO-PDF-Source": pdfSource } });
  } catch (error: any) {
    console.error("Purchase Order PDF generation failed", error);
    return jsonError("Could not generate the Purchase Order PDF. Please try again.", 500);
  }
}
