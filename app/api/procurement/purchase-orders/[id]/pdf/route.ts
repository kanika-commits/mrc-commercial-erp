import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { applyCompanySiteAccess, applyOrganizationAccess, adminClient, jsonError, requireProcurementAny } from "@/lib/serverProcurementAccess";
import { parsePurchaseOrderStandardTerms } from "@/lib/procurement/standardTerms";
import { getEmployeeSignatureBlock } from "@/lib/hr/employeeSignature";

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 42;
const RIGHT = 553;
const TOP = 735;
const SECTION_GAP = 6;
const SECTION_HEADING_BEFORE = 14;
const HEADING_GAP = 4;
const CELL_PAD_X = 4;
const CELL_PAD_TOP = 6;
const CELL_PAD_BOTTOM = 5;
const ITEM_PAD_TOP = 5;
const ITEM_PAD_BOTTOM = 5;
const BODY_SIZE = 10;
const BODY_LEADING = 14;
const TERMS_SIZE = 8;
const TERMS_LEADING = 10;
const FOOTER_SAFETY_GAP = 2;
const PAGE_NUMBER_SIZE = 8;
const PAGE_NUMBER_OFFSET = 2;
const PAGE_NUMBER_BODY_GAP = 2;

function text(value: unknown) { return value === null || value === undefined || String(value).trim() === "" ? "—" : String(value); }
function money(value: unknown) { return `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value: unknown) { const parts = String(value || "").slice(0, 10).split("-"); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : text(value); }
function esc(value: unknown) { return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
function formatCreatorName(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`); }
function cleanDisplay(value: unknown) { const result = String(value ?? "").trim(); return result || null; }
function firstDisplayValue(...values: unknown[]) { return values.map(cleanDisplay).find(Boolean) || null; }
function isPhoneLike(value: unknown) { return /^\+?[\d\s().-]{7,}$/.test(String(value ?? "").trim()); }
function frozenBillingContactName(address: any) {
  const contactName = cleanDisplay(address?.contact_name || address?.contact?.contact_name);
  const mobile = cleanDisplay(address?.mobile || address?.contact?.mobile);
  return contactName && !isPhoneLike(contactName) ? contactName : mobile && !isPhoneLike(mobile) ? mobile : contactName || mobile;
}
function frozenBillingContactMobile(address: any) {
  const contactName = cleanDisplay(address?.contact_name || address?.contact?.contact_name);
  const mobile = cleanDisplay(address?.mobile || address?.contact?.mobile);
  return mobile && isPhoneLike(mobile) ? mobile : contactName && isPhoneLike(contactName) ? contactName : mobile || contactName;
}
function wrap(value: unknown, width: number) { return String(value ?? "").split(/\r?\n/).flatMap((line) => { const words = line.split(/\s+/).filter(Boolean); if (!words.length) return [""]; const lines: string[] = []; let current = ""; for (const word of words) { if ((current + " " + word).trim().length > width && current) { lines.push(current); current = word; } else current = (current + " " + word).trim(); } if (current) lines.push(current); return lines; }); }
function isClauseHeading(value: string) { return /^(variation in quantity|quality of material|testing|taxes & duties|registration under|warranty|escalation|settlement of disputes|final say)\b.*:?$/i.test(value.trim()) || /^[^\s].{2,80}:$/.test(value.trim()); }
function termIndent(value: string) {
  if (/^[a-z]\./i.test(value.trim())) return LEFT + 10;
  if (/^[ivxlcdm]+\./i.test(value.trim())) return LEFT + 5;
  return LEFT;
}
function textWidth(value: string, size: number) { return value.length * size * 0.52; }
function wrapToPointWidth(value: unknown, maxWidth: number, size: number, measure = textWidth) { return String(value ?? "").split(/\r?\n/).flatMap((line) => { const words = line.split(/\s+/).filter(Boolean); if (!words.length) return [""]; const lines: string[] = []; let current = ""; for (const word of words) { const candidate = (current + " " + word).trim(); if (measure(candidate, size) > maxWidth && current) { lines.push(current); current = word; } else current = candidate; } if (current) lines.push(current); return lines; }); }

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
        const sharp = await loadSharp();
        const image = document.mime_type === "image/webp" ? await sharp(bytes).png().toBuffer() : bytes;
        const metadata = await sharp(image).metadata();
        const embedded = document.mime_type === "image/jpeg" ? await output.embedJpg(image) : await output.embedPng(image);
        const page = output.addPage([595, 842]);
        const scale = Math.min(535 / (metadata.width || 1), 782 / (metadata.height || 1));
        const width = (metadata.width || 1) * scale; const height = (metadata.height || 1) * scale;
        page.drawImage(embedded, { x: (595 - width) / 2, y: (842 - height) / 2, width, height });
      }
    } catch { throw new Error(`Supporting document ${text(document.original_file_name)} is unreadable.`); }
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

type TermsLevel = "main" | "roman" | "alpha" | "body";
type TermsLine = {
  raw: string;
  level: TermsLevel;
  marker: string;
  content: string;
  indent: number;
  markerOffset: number;
  spacingBefore: number;
  spacingAfter: number;
  bold: boolean;
};

function parseTermsLine(raw: string): TermsLine {
  const trimmed = raw.trim();
  const mainMatch = trimmed.match(/^(\d+\.)\s*(.+)$/);
  if (mainMatch) {
    return { raw: trimmed, level: "main", marker: mainMatch[1], content: mainMatch[2], indent: LEFT, markerOffset: 0, spacingBefore: 2, spacingAfter: 0, bold: true };
  }
  const romanMatch = trimmed.match(/^([ivxlcdm]+\.)\s*(.+)$/i);
  if (romanMatch) {
    return { raw: trimmed, level: "roman", marker: romanMatch[1], content: romanMatch[2], indent: LEFT + 7, markerOffset: 0, spacingBefore: 1, spacingAfter: 0, bold: false };
  }
  const alphaMatch = trimmed.match(/^([a-z]\.)\s*(.+)$/i);
  if (alphaMatch) {
    return { raw: trimmed, level: "alpha", marker: alphaMatch[1], content: alphaMatch[2], indent: LEFT + 14, markerOffset: 0, spacingBefore: 0, spacingAfter: 0, bold: false };
  }
  if (isClauseHeading(trimmed)) {
    return { raw: trimmed, level: "main", marker: "", content: trimmed, indent: LEFT, markerOffset: 0, spacingBefore: 4, spacingAfter: 1, bold: true };
  }
  return { raw: trimmed, level: "body", marker: "", content: trimmed, indent: termIndent(trimmed), markerOffset: 0, spacingBefore: 0, spacingAfter: 1, bold: false };
}

type ImageAsset = { name: string; data: Buffer; width: number; height: number; format: "jpeg" | "png" };
type PdfPage = { ops: string[]; images: ImageAsset[] };

async function imageAsset(name: string, file: string, cropHeight?: number) {
  const sharp = await loadSharp();
  const sourceBuffer = await fs.readFile(path.join(process.cwd(), "public", "letterheads", file));
  const metadata = await sharp(sourceBuffer).metadata();
  const scaledHeight = metadata.width && metadata.height ? Math.floor(metadata.height * PAGE_W / metadata.width) : PAGE_H;
  const safeCropHeight = cropHeight ? Math.min(cropHeight, Math.max(1, scaledHeight)) : undefined;
  const source = sharp(sourceBuffer);
  let image = source.resize({ width: PAGE_W, withoutEnlargement: false });
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

async function employeeSignatureImageAsset(admin: any, approverUserId: string | null | undefined) {
  if (!approverUserId) return { block: null, asset: null };
  const block = await getEmployeeSignatureBlock(admin, { userId: approverUserId, includeSignedUrl: false });
  if (!block?.storageBucket || !block.storageKey) return { block, asset: null };
  const downloaded = await admin.storage.from(block.storageBucket).download(block.storageKey);
  if (downloaded.error || !downloaded.data) return { block, asset: null };
  try {
    const sharp = await loadSharp();
    const source = Buffer.from(await downloaded.data.arrayBuffer());
    const data = await sharp(source)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const metadata = await sharp(data).metadata();
    return {
      block,
      asset: {
        name: "approverSignature",
        data,
        width: metadata.width || 150,
        height: metadata.height || 50,
        format: "jpeg",
      } satisfies ImageAsset,
    };
  } catch {
    return { block, asset: null };
  }
}

async function makeLetterhead(row: any, admin: any) {
  const frozen = row.delivery_snapshot?.letterhead || null;
  if (frozen?.header_storage_bucket && frozen?.header_storage_key && frozen?.footer_storage_bucket && frozen?.footer_storage_key) {
    const [headerResult, footerResult] = await Promise.all([
      admin.storage.from(frozen.header_storage_bucket).download(frozen.header_storage_key),
      admin.storage.from(frozen.footer_storage_bucket).download(frozen.footer_storage_key),
    ]);
    if (headerResult.error || !headerResult.data || footerResult.error || !footerResult.data) throw new Error("Frozen Purchase Order letterhead assets could not be downloaded.");
    const header = await storageImageAsset("frozenHeader", Buffer.from(await headerResult.data.arrayBuffer()), Number(frozen.header_height_points || 150));
    const footer = await storageImageAsset("frozenFooter", Buffer.from(await footerResult.data.arrayBuffer()), Number(frozen.footer_height_points || 66));
    return { header, footer, fullPage: false };
  }
  const identity = `${row.company?.company_code || ""} ${row.company?.company_name || ""}`.toLowerCase();
  if (identity.includes("tech") || identity.includes("mrc-tech")) return {
    header: await imageAsset("techHeader", "mrc-tech-header.png", 150),
    footer: await imageAsset("techFooter", "mrc-tech-footer.png", 66),
    fullPage: false,
  };
  if (identity.includes("infracon") || identity.includes("mrc-infracon")) return {
    header: await imageAsset("infraconHeader", "mrc-infracon-header.png", 150),
    footer: await imageAsset("infraconFooter", "mrc-infracon-footer.png", 125),
    fullPage: false,
  };
  return { header: null, footer: null, fullPage: false };
}

async function makePdf(row: any, creator: any, approver: any, admin: any) {
  const letterhead = await makeLetterhead(row, admin);
  const footerRenderedHeight = letterhead.footer ? PAGE_W * letterhead.footer.height / letterhead.footer.width : 0;
  const headerRenderedHeight = letterhead.header ? PAGE_W * letterhead.header.height / letterhead.header.width : 0;
  const contentTop = letterhead.header ? PAGE_H - headerRenderedHeight - 8 : TOP;
  const pageNumberBaselineY = footerRenderedHeight + PAGE_NUMBER_OFFSET;
  const pageNumberTopY = pageNumberBaselineY + PAGE_NUMBER_SIZE;
  const bodyBottomY = letterhead.footer ? Math.max(footerRenderedHeight + FOOTER_SAFETY_GAP, pageNumberTopY + PAGE_NUMBER_BODY_GAP) : 72;
  const metricsPdf = await PDFDocument.create();
  const termsFont = await metricsPdf.embedFont("Helvetica");
  const termsTextWidth = (value: string, size: number) => termsFont.widthOfTextAtSize(value, size);
  const pages: PdfPage[] = [];
  let page: PdfPage;
  let y = TOP;
  const newPage = () => { page = { ops: [], images: [] }; pages.push(page); y = contentTop; if (letterhead.header) { page.images.push(letterhead.header); if (letterhead.header.format === "jpeg") page.ops.push(letterhead.fullPage ? `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /${letterhead.header.name} Do Q` : `q ${PAGE_W} 0 0 ${headerRenderedHeight} 0 ${PAGE_H - headerRenderedHeight} cm /${letterhead.header.name} Do Q`); } if (letterhead.footer) { page.images.push(letterhead.footer); if (letterhead.footer.format === "jpeg") page.ops.push(`q ${PAGE_W} 0 0 ${footerRenderedHeight} 0 0 cm /${letterhead.footer.name} Do Q`); } };
  const ensure = (height: number) => { if (y - height < bodyBottomY) newPage(); };
  const line = (x: number, yy: number, x2: number, yy2: number) => page.ops.push(`${x} ${yy} m ${x2} ${yy2} l S`);
  const tableLine = (x: number, yy: number, x2: number, yy2: number, strong = false) => page.ops.push(`q ${strong ? "0.45" : "0.78"} G ${strong ? "0.8" : "0.45"} w ${x} ${yy} m ${x2} ${yy2} l S Q`);
  const tableFill = (x: number, yy: number, width: number, height: number, color = "0.96 0.97 0.98") => page.ops.push(`q ${color} rg ${x} ${yy} ${width} ${height} re f Q`);
  const rect = (x: number, yy: number, w: number, h: number) => page.ops.push(`${x} ${yy} ${w} ${h} re S`);
  const rowGrid = (x: number, top: number, widths: number[], height: number, mergedStart?: number) => {
    const bottom = top - height;
    tableLine(x, bottom, x + widths.reduce((sum, width) => sum + width, 0), bottom);
    let cursor = x;
    tableLine(cursor, bottom, cursor, top);
    for (let index = 0; index < widths.length; index += 1) {
      cursor += widths[index];
      if (mergedStart === undefined || index < mergedStart || index === mergedStart) tableLine(cursor, bottom, cursor, top);
    }
  };
  const draw = (value: unknown, x: number, yy: number, size = 9, bold = false) => page.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${esc(value)}) Tj ET`);
  const drawAligned = (value: string, cellX: number, cellW: number, yy: number, size: number, align: "left" | "center" | "right" = "left", bold = false) => {
    const width = textWidth(value, size);
    if (align === "right") {
      draw(value, Math.max(cellX + CELL_PAD_X, cellX + cellW - CELL_PAD_X - width), yy, size, bold);
      return;
    }
    if (align === "center") {
      draw(value, cellX + Math.max(CELL_PAD_X, (cellW - width) / 2), yy, size, bold);
      return;
    }
    draw(value, cellX + CELL_PAD_X, yy, size, bold);
  };
  const centered = (value: string, size: number) => draw(value, LEFT + ((RIGHT - LEFT) - value.length * size * 0.52) / 2, y, size, true);
  const heading = (value: string, firstContentHeight = 0) => {
    const requiredHeight = SECTION_HEADING_BEFORE + 15 + HEADING_GAP + firstContentHeight;
    if (y - requiredHeight < bodyBottomY) newPage();
    else y -= SECTION_HEADING_BEFORE;
    draw(value, LEFT, y, 10, true);
    y -= 15 + HEADING_GAP;
  };
  const table = (headers: string[], rows: string[][], widths: number[], size = 8) => {
    const renderRow = (cells: string[], header = false) => {
      const lines = cells.map((cell, i) => wrap(cell, Math.max(8, Math.floor((widths[i] - CELL_PAD_X * 2) / (size * 0.52)))));
      const lineHeight = size + 2;
      const h = Math.max(...lines.map((items) => items.length)) * lineHeight + CELL_PAD_TOP + CELL_PAD_BOTTOM;
      if (y - h < bodyBottomY) { newPage(); line(LEFT, y, RIGHT, y); if (!header) renderRow(headers, true); }
      if (header) tableFill(LEFT, y - h, widths.reduce((sum, width) => sum + width, 0), h);
      let x = LEFT;
      for (let i = 0; i < cells.length; i += 1) {
        const firstBaseline = y - CELL_PAD_TOP - lineHeight * 0.78;
        lines[i].forEach((item, index) => draw(item, x + CELL_PAD_X, firstBaseline - index * lineHeight, size, header));
        x += widths[i];
      }
      rowGrid(LEFT, y, widths, h);
      y -= h;
    };
      line(LEFT, y, RIGHT, y); renderRow(headers, true); rows.forEach((rowData) => renderRow(rowData)); y -= 3;
  };
  const addressTable = (cells: string[]) => {
    const widths = [270, 241];
    const padding = 8;
    const lineHeight = 11;
    const wrapAddress = (value: string, maxWidth: number) => String(value).split(/\r?\n/).flatMap((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      if (!words.length) return [""];
      const lines: string[] = [];
      let current = "";
      const pushWord = (word: string) => {
        let chunk = "";
        for (const character of word) {
          const candidate = chunk + character;
          if (termsTextWidth(candidate, 9) > maxWidth && chunk) { lines.push(chunk); chunk = character; } else chunk = candidate;
        }
        if (chunk) current = chunk;
      };
      for (const word of words) {
        if (termsTextWidth(word, 9) > maxWidth) {
          if (current) { lines.push(current); current = ""; }
          pushWord(word);
          continue;
        }
        const candidate = (current + " " + word).trim();
        if (termsTextWidth(candidate, 9) > maxWidth && current) { lines.push(current); current = ""; pushWord(word); } else current = candidate;
      }
      if (current) lines.push(current);
      return lines;
    });
    const renderRow = (rowCells: string[], header = false) => {
      const lines = rowCells.map((cell, index) => wrapAddress(cell, widths[index] - padding * 2));
      const height = Math.max(...lines.map((items) => items.length)) * lineHeight + padding * 2;
      if (y - height < bodyBottomY) newPage();
      if (header) tableFill(LEFT, y - height, RIGHT - LEFT, height);
      lines.forEach((items, index) => items.forEach((item, lineIndex) => draw(item, LEFT + widths.slice(0, index).reduce((sum, width) => sum + width, 0) + padding, y - padding - lineHeight * 0.78 - lineIndex * lineHeight, 9, header)));
      rowGrid(LEFT, y, widths, height);
      y -= height;
    };
    line(LEFT, y, RIGHT, y);
    renderRow(["Billing Address", "Shipping / Delivery Address"], true);
    renderRow(cells);
    y -= 3;
  };
  const itemTable = (rows: string[][], widths: number[]) => {
    const headers = ["S.No.", "Material / Description", "Make", "Qty", "Unit", "Rate", "GST", "Amount"];
    const aligns: Array<"left" | "center" | "right"> = ["center", "left", "left", "center", "center", "right", "right", "right"];
    const headerAligns: Array<"left" | "center" | "right"> = ["center", "left", "left", "center", "center", "center", "center", "center"];
    const tableRight = LEFT + widths.reduce((sum, width) => sum + width, 0);
    const drawOuterRowBorders = (top: number, height: number) => {
      tableLine(LEFT, top, tableRight, top, true);
      tableLine(LEFT, top - height, tableRight, top - height, true);
      tableLine(LEFT, top - height, LEFT, top, true);
      tableLine(tableRight, top - height, tableRight, top, true);
    };
    const render = (cells: string[], bold = false, summary = false) => {
      const lines = cells.map((cell, i) => wrap(cell, Math.max(8, Math.floor((widths[i] - CELL_PAD_X * 2) / (7 * 0.52)))));
      const h = summary ? Math.max(17, Math.max(...lines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM) : Math.max(...lines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM;
      if (y - h < bodyBottomY) { newPage(); line(LEFT, y, RIGHT, y); if (!summary) render(headers, true); }
      if (bold && !summary) tableFill(LEFT, y - h, tableRight - LEFT, h);
      let x = LEFT;
      for (let i = 0; i < cells.length; i += 1) {
        const lineHeight = 9;
        const textBlockHeight = lines[i].length * lineHeight;
        const firstBaseline = summary ? y - h + (h - textBlockHeight) / 2 + lineHeight * 0.78 : y - ITEM_PAD_TOP - lineHeight * 0.78;
        lines[i].forEach((item, index) => drawAligned(item, x, widths[i], firstBaseline - index * lineHeight, 7, bold ? headerAligns[i] : aligns[i], bold));
        x += widths[i];
      }
      if (!summary) {
        drawOuterRowBorders(y, h);
        let boundary = LEFT;
        for (const width of widths) {
          boundary += width;
          tableLine(boundary, y - h, boundary, y);
        }
      } else {
        drawOuterRowBorders(y, h);
        const totalsLabelX = LEFT + widths.slice(0, 6).reduce((sum, width) => sum + width, 0);
        const amountX = totalsLabelX + widths[6];
        tableLine(totalsLabelX, y - h, totalsLabelX, y);
        tableLine(amountX, y - h, amountX, y);
      }
      y -= h;
    };
    render(headers, true); rows.forEach((rowData) => render(rowData));
    const additionalCharges = Array.isArray(row.commercial_snapshot?.additional_charges) ? row.commercial_snapshot.additional_charges : [];
    const summaryRows = [...(additionalCharges.length ? additionalCharges.map((charge: any) => [text(charge.name), money(Number(charge.amount || 0))]) : [["Freight", money(row.total_freight_amount)]]), ["Items Basic", money(row.total_basic_amount)], ["GST", money(row.total_gst_amount)], ["Total Amount", money(row.total_amount)]];
    for (const [label, amount] of summaryRows) {
      const summaryCells = [String(label), String(amount)];
      const summaryLines = summaryCells.map((cell, index) => wrap(cell, Math.max(8, Math.floor((widths[index === 0 ? 6 : 7] - CELL_PAD_X * 2) / (7 * 0.52)))));
      const summaryHeight = Math.max(17, Math.max(...summaryLines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM);
      if (y - summaryHeight < bodyBottomY) { newPage(); render(headers, true); }
      const totalsLabelX = LEFT + widths.slice(0, 6).reduce((sum, value) => sum + value, 0);
      const amountX = totalsLabelX + widths[6];
      const emphasized = label === "Items Basic" || label === "GST" || label === "Total Amount";
      if (label === "Total Amount") tableFill(LEFT, y - summaryHeight, tableRight - LEFT, summaryHeight, "0.93 0.95 0.97");
      for (const [lineIndex, lineText] of summaryLines[0].entries()) drawAligned(lineText, totalsLabelX, widths[6], y - summaryHeight + (summaryHeight - summaryLines[0].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, "left", emphasized);
      for (const [lineIndex, lineText] of summaryLines[1].entries()) drawAligned(lineText, amountX, widths[7], y - summaryHeight + (summaryHeight - summaryLines[1].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, "right", label === "Total Amount");
      drawOuterRowBorders(y, summaryHeight);
      tableLine(totalsLabelX, y - summaryHeight, totalsLabelX, y);
      tableLine(amountX, y - summaryHeight, amountX, y);
      y -= summaryHeight;
    }
    y -= 4;
  };

  newPage();
  if (!letterhead.header) { draw(row.company?.company_name || "Purchase Order", LEFT, y, 16, true); y -= 28; }
  ensure(28); centered("Purchase Order", 13); y -= 22;

  const vendor = row.vendor_snapshot || {};
  const delivery = row.delivery_snapshot || {};
  const billing = delivery.gst_billing || delivery.billing_address || {};
  const shipping = delivery.delivery_location || delivery.shipping_address || delivery;
  const billingContact = delivery.billing_contact || billing;
  const contact = delivery.delivery_contact || delivery.site_contact || {};
  const billingCompany = firstDisplayValue(billing.legal_name, billing.company_name, billing.company, billing.trade_name, billing.label);
  let deliveryCompany = firstDisplayValue(shipping.company_name);
  if (!deliveryCompany && cleanDisplay(shipping.company_id)) {
    // Legacy snapshots may retain only the exact frozen Delivery Company ID.
    const legacyCompany = await admin.from("companies").select("company_name").eq("id", shipping.company_id).eq("organization_id", row.organization_id).maybeSingle();
    if (legacyCompany.error) throw legacyCompany.error;
    deliveryCompany = firstDisplayValue(legacyCompany.data?.company_name);
  }
  const shippingAddress = shipping.address || [shipping.address_line1, shipping.address_line2, shipping.city, shipping.state, shipping.pincode].filter(Boolean).join(", ");
  table(["Vendor Details", "Purchase Order Details"], [[
    `Vendor Name: ${text(row.vendor_name_snapshot)}\nContact Person: ${text(vendor.contact_person || vendor.contact_name)}\nAddress: ${text(vendor.address)}\nMobile: ${text(vendor.phone || vendor.mobile)}\nEmail: ${text(vendor.email)}\nGSTIN: ${text(vendor.gstin)}`,
    `Purchase Order No: ${text(row.po_number)}\nDate: ${date(row.po_date)}\nCompany: ${text(row.company?.company_name)}\nSite: ${text(row.site?.site_name)}`,
  ]], [270, 241], 9);

  y -= SECTION_GAP;
  addressTable([
    `Company: ${text(billingCompany)}\nGSTIN: ${text(billing.gstin)}\nAddress: ${text(billing.address || [billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", "))}\nContact Person: ${text(frozenBillingContactName(billingContact))}\nMobile: ${text(frozenBillingContactMobile(billingContact))}`,
    `Company: ${text(deliveryCompany)}\nGSTIN: ${text(shipping.gstin || delivery.shipping_gstin)}\nSite / Location: ${text(shipping.location_name || shipping.location || row.site?.site_name)}\nAddress: ${text(shippingAddress)}\nContact Person: ${text(contact.contact_name || shipping.contact_name)}\nMobile: ${text(contact.mobile || shipping.mobile)}`,
  ]);

  heading("ITEMS", 19);
  itemTable((row.items || []).map((item: any, index: number) => [String(index + 1), `${text(item.item_name_snapshot)}\n${text(item.item_code_snapshot)}${item.specification_snapshot ? `\n${item.specification_snapshot}` : ""}`, text(item.make_snapshot), text(item.quantity), text(item.uom_snapshot), money(item.unit_rate), `${item.gst_rate || 0}%\n${money(item.gst_amount)}`, money(item.total_amount)]), [24, 155, 48, 28, 34, 64, 78, 80]);

  const keyTerms = Array.isArray(row.commercial_snapshot?.key_terms) ? row.commercial_snapshot.key_terms : [];
  heading("KEY TERMS", 22);
  table(["S.No.", "Description", "Terms"], keyTerms.length ? keyTerms.map((term: any, index: number) => [String(index + 1), text(term.description || term.label), text(term.value || term.terms || term.text)]) : [["—", "—", "No key terms added."]], [38, 160, 313], 9);

  const parsedTerms = parsePurchaseOrderStandardTerms(row.standard_terms_snapshot);
  const terms = !parsedTerms ? ["No standard terms added."] : parsedTerms.kind === "structured" ? parsedTerms.clauses.flatMap((clause, index) => [`${index + 1}. ${clause.heading}`, ...clause.clause_body.split(/\r?\n/)]) : parsedTerms.text.split(/\r?\n/);
  const firstTerm = terms.map((entry) => entry.trim()).find(Boolean);
  const firstTermParsed = firstTerm ? parseTermsLine(firstTerm) : null;
  const firstTermHeight = firstTermParsed ? firstTermParsed.spacingBefore + TERMS_LEADING + firstTermParsed.spacingAfter : TERMS_LEADING;
  heading("TERMS & CONDITIONS", firstTermHeight);
  for (let index = 0; index < terms.length; index += 1) {
    const raw = terms[index].trim();
    if (!raw) { y -= TERMS_LEADING; continue; }
    const parsed = parseTermsLine(raw);
    const markerWidth = parsed.marker ? termsTextWidth(`${parsed.marker} `, TERMS_SIZE) : 0;
    const textX = parsed.indent + markerWidth + parsed.markerOffset;
    const availableWidth = Math.max(42, RIGHT - textX);
    const lines = wrapToPointWidth(parsed.content || parsed.raw, availableWidth, TERMS_SIZE, termsTextWidth);
    const nextRaw = terms.slice(index + 1).map((entry) => entry.trim()).find(Boolean);
    const nextParsed = nextRaw ? parseTermsLine(nextRaw) : null;
    const nextMarkerWidth = nextParsed?.marker ? termsTextWidth(`${nextParsed.marker} `, TERMS_SIZE) : 0;
    const nextTextX = nextParsed ? nextParsed.indent + nextMarkerWidth + nextParsed.markerOffset : LEFT;
    const nextAvailableWidth = nextParsed ? Math.max(42, RIGHT - nextTextX) : 0;
    const nextLines = nextParsed ? wrapToPointWidth(nextParsed.content || nextParsed.raw, nextAvailableWidth, TERMS_SIZE, termsTextWidth) : [];
    const estimatedNextHeight = nextParsed ? nextParsed.spacingBefore + nextLines.length * TERMS_LEADING + nextParsed.spacingAfter : 0;
    const requiredHeight = parsed.spacingBefore + lines.length * TERMS_LEADING + parsed.spacingAfter + (parsed.level === "main" && nextParsed ? Math.min(estimatedNextHeight, TERMS_LEADING * 2 + 4) : 0);
    if (y - requiredHeight < bodyBottomY) newPage();
    y -= parsed.spacingBefore;
    if (parsed.marker) draw(parsed.marker, parsed.indent, y, TERMS_SIZE, parsed.bold);
    for (const [lineIndex, term] of lines.entries()) {
      ensure(TERMS_LEADING);
      draw(term, textX, y, TERMS_SIZE, parsed.bold);
      y -= TERMS_LEADING;
    }
    y -= parsed.spacingAfter;
  }

  const finalStatus = row.status === "approved" || row.status === "issued";
  const vendorName = cleanDisplay(row.vendor_name_snapshot || vendor.vendor_name);
  const approverSignatureBlock = finalStatus ? approver?.signatureBlock : null;
  const approverSignatureAsset = finalStatus ? approver?.signatureAsset as ImageAsset | null : null;
  const internalName = formatCreatorName(finalStatus ? approverSignatureBlock?.employeeName || approver?.employee_name || row.approved_by_name : creator?.employee_name || row.created_by_name);
  const internalDesignation = finalStatus ? approverSignatureBlock?.designation || approver?.designation?.designation_name : creator?.designation?.designation_name;
  const internalCompany = finalStatus ? cleanDisplay(approverSignatureBlock?.company || approver?.company?.company_name) : null;
  const signaturePadding = 9;
  const dividerX = LEFT + (RIGHT - LEFT) / 2;
  const leftInnerX = LEFT + signaturePadding;
  const leftInnerRight = dividerX - signaturePadding;
  const rightInnerX = dividerX + signaturePadding;
  const rightInnerRight = RIGHT - signaturePadding;
  const wrapSignature = (value: string, maxWidth: number, size: number) => value.split(/\r?\n/).flatMap((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (termsTextWidth(word, size) > maxWidth) {
        if (current) { lines.push(current); current = ""; }
        let chunk = "";
        for (const character of word) {
          if (termsTextWidth(chunk + character, size) > maxWidth && chunk) { lines.push(chunk); chunk = character; } else chunk += character;
        }
        current = chunk;
        continue;
      }
      const candidate = (current + " " + word).trim();
      if (termsTextWidth(candidate, size) > maxWidth && current) { lines.push(current); current = word; } else current = candidate;
    }
    if (current) lines.push(current);
    return lines;
  });
  const vendorLines = [
    ["Vendor Acceptance", true, 8],
    ["I hereby accept the terms and conditions of this Purchase Order and confirm acceptance on behalf of the Vendor.", false, 7],
    [vendorName ? `For: ${vendorName}` : "For: —", false, 7],
    ["Name: ____________________", false, 7],
    ["Designation: ____________________", false, 7],
    ["Signature: ____________________", false, 7],
  ] as Array<[string, boolean, number]>;
  const internalLines = (finalStatus
    ? [["Approved By", true, 8], [`For: ${internalCompany || "—"}`, false, 8], ...(approverSignatureAsset ? [] : [["Signature: ____________________", false, 8] as [string, boolean, number]]), [`Name: ${internalName || "—"}`, false, 8], [`Designation: ${internalDesignation || "—"}`, false, 8]]
    : [["Prepared By", true, 8], [`Name: ${internalName || "—"}`, false, 8], [`Email: ${creator?.email || row.created_by_email || "—"}`, false, 8]]) as Array<[string, boolean, number]>;
  const signatureLineHeight = 10;
  const prepareSignatureLines = (lines: Array<[string, boolean, number]>, maxWidth: number) => lines.flatMap(([value, bold, size]) => wrapSignature(value, maxWidth, size).map((wrapped) => [wrapped, bold, size] as [string, boolean, number]));
  const leftSignatureLines = prepareSignatureLines(vendorLines, leftInnerRight - leftInnerX);
  const rightSignatureLines = prepareSignatureLines(internalLines, rightInnerRight - rightInnerX);
  const signatureMaxWidth = Math.min(150, rightInnerRight - rightInnerX);
  const signatureMaxHeight = 45;
  const signatureImageScale = approverSignatureAsset ? Math.min(signatureMaxWidth / Math.max(1, approverSignatureAsset.width), signatureMaxHeight / Math.max(1, approverSignatureAsset.height), 1) : 0;
  const signatureImageWidth = approverSignatureAsset ? approverSignatureAsset.width * signatureImageScale : 0;
  const signatureImageHeight = approverSignatureAsset ? approverSignatureAsset.height * signatureImageScale : 0;
  const signatureCellHeight = (lines: Array<[string, boolean, number]>, imageHeight = 0) => signaturePadding * 2 + lines.length * signatureLineHeight + (imageHeight ? imageHeight + 6 : 0);
  const signatureTableHeight = Math.max(signatureCellHeight(leftSignatureLines), signatureCellHeight(rightSignatureLines, signatureImageHeight));
  y -= 20;
  if (y - signatureTableHeight < bodyBottomY) newPage();
  const finalPage = pages[pages.length - 1];
  const signatureTop = y;
  tableLine(LEFT, signatureTop, RIGHT, signatureTop, true);
  tableLine(LEFT, signatureTop - signatureTableHeight, RIGHT, signatureTop - signatureTableHeight, true);
  tableLine(LEFT, signatureTop - signatureTableHeight, LEFT, signatureTop, true);
  tableLine(RIGHT, signatureTop - signatureTableHeight, RIGHT, signatureTop, true);
  tableLine(dividerX, signatureTop - signatureTableHeight, dividerX, signatureTop, true);
  const drawSignatureCell = (lines: Array<[string, boolean, number]>, x: number) => lines.forEach(([value, bold, size], index) => draw(value, x, signatureTop - signaturePadding - signatureLineHeight * 0.78 - index * signatureLineHeight, size, bold));
  const drawApproverCell = () => {
    let cursorY = signatureTop - signaturePadding - signatureLineHeight * 0.78;
    rightSignatureLines.forEach(([value, bold, size], index) => {
      draw(value, rightInnerX, cursorY, size, bold);
      cursorY -= signatureLineHeight;
      if (index === 1 && approverSignatureAsset) {
        const imageX = rightInnerX;
        const imageY = cursorY - signatureImageHeight + 2;
        finalPage.images.push(approverSignatureAsset);
        finalPage.ops.push(`q ${signatureImageWidth} 0 0 ${signatureImageHeight} ${imageX} ${imageY} cm /${approverSignatureAsset.name} Do Q`);
        cursorY -= signatureImageHeight + 6;
      }
    });
  };
  drawSignatureCell(leftSignatureLines, leftInnerX);
  drawApproverCell();
  y = signatureTop - signatureTableHeight;

  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const imageObjects = new Map<ImageAsset, number>();
  for (const currentPage of pages) for (const image of currentPage.images) if (image.format === "jpeg" && !imageObjects.has(image)) imageObjects.set(image, add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data.toString("binary")}\nendstream`));
  const contentIds = pages.map((currentPage) => add(`<< /Length ${Buffer.byteLength(currentPage.ops.join("\n"))} >>\nstream\n${currentPage.ops.join("\n")}\nendstream`));
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length + 2;
  for (let i = 0; i < pages.length; i += 1) { const resourceImages = pages[i].images.filter((image) => image.format === "jpeg").map((image) => `/${image.name} ${imageObjects.get(image)} 0 R`).join(" "); pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> ${resourceImages ? `/XObject << ${resourceImages} >>` : ""} >> /Contents ${contentIds[i]} 0 R >>`)); }
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const pagesObject = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  if (pagesObject !== pagesId) throw new Error("PDF page tree construction failed.");
  let output = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output, "latin1")); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(output, "latin1"); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdf = await PDFDocument.load(Buffer.from(output, "binary"));
  const embeddedPngs = new Map<ImageAsset, any>();
  for (const currentPage of pages) {
    const pdfPage = pdf.getPages()[pages.indexOf(currentPage)];
    for (const image of currentPage.images) {
      if (image.format !== "png") continue;
      let embedded = embeddedPngs.get(image);
      if (!embedded) { embedded = await pdf.embedPng(image.data); embeddedPngs.set(image, embedded); }
      const width = PAGE_W;
      const height = width * image.height / image.width;
      const yPosition = image.name === "frozenHeader" ? PAGE_H - height : 0;
      pdfPage.drawImage(embedded, { x: 0, y: yPosition, width, height });
    }
  }
  return { pdf: Buffer.from(await pdf.save()), pageCount: pages.length, footerRenderedHeight };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const auth = await requireProcurementAny(request, [{ moduleCode: "procurement_purchase_orders", actionCode: "view" }, { moduleCode: "procurement_purchase_orders", actionCode: "edit" }, { moduleCode: "procurement_purchase_orders", actionCode: "approve" }]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, company:companies(company_name,company_code), site:sites(site_name,site_code), items:procurement_purchase_order_items(*), events:procurement_purchase_order_events(event_type,actor_id,actor_name,actor_email,created_at)").eq("id", id).maybeSingle(), auth);
    query = query && applyCompanySiteAccess(query, auth);
    if (!query) return jsonError("Purchase Order was not found.", 404);
    const { data, error } = await query;
    if (error) throw error;
    if (!data) return jsonError("Purchase Order was not found.", 404);
    const creatorResult = data.created_by ? await admin.from("hr_employees").select("employee_name,email,phone,personal_phone,company:companies(company_name),designation:hr_designations(designation_name)").eq("user_id", data.created_by).eq("organization_id", data.organization_id).eq("status", "active").maybeSingle() : { data: null, error: null };
    if (creatorResult.error) throw creatorResult.error;
    const approvalEvent = Array.isArray(data.events) ? data.events.filter((event: any) => ["approve", "approved"].includes(event.event_type)).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0] : null;
    const approverId = approvalEvent?.actor_id || data.approved_by;
    const approverResult = approverId ? await admin.from("hr_employees").select("employee_name,email,phone,personal_phone,company:companies(company_name),designation:hr_designations(designation_name)").eq("user_id", approverId).eq("organization_id", data.organization_id).eq("status", "active").maybeSingle() : { data: null, error: null };
    if (approverResult.error) throw approverResult.error;
    const approverSignature = await employeeSignatureImageAsset(admin, approverId);
    const poPackage = await makePdf(data, creatorResult.data, { ...approverResult.data, signatureBlock: approverSignature.block, signatureAsset: approverSignature.asset, employee_name: approverResult.data?.employee_name || approvalEvent?.actor_name || data.approved_by_name, approval_at: approvalEvent?.created_at || data.approved_at }, admin);
    const combinedPdf = await appendPackage(poPackage.pdf, data, admin);
    const protectedPdf = ["approved", "issued"].includes(data.status) ? combinedPdf : await watermarkDraftPackage(combinedPdf);
    const finalPdf = await numberPackage(protectedPdf, poPackage.pageCount, poPackage.footerRenderedHeight);
    return new NextResponse(new Uint8Array(finalPdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${String(data.po_number || "purchase-order").replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    console.error("Purchase Order PDF generation failed", error);
    return jsonError("Could not generate the Purchase Order PDF. Please try again.", 500);
  }
}
