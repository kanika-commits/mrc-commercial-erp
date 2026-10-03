import { PDFDocument, PDFPage, PDFFont, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from "pdf-lib";
import { adminClient } from "@/lib/serverProcurementAccess";

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 28;
const RIGHT = 567;
const CONTENT = RIGHT - LEFT;
const BODY_BOTTOM = 46;
const BODY_SIZE = 8;
const LEADING = 10;
const BORDER = rgb(0.55, 0.58, 0.62);
const HEADER_FILL = rgb(0.93, 0.86, 0.86);

type Asset = { data: Buffer; width: number; height: number; format: "png" | "jpeg" };
export type WorkOrderLetterheadAssets = { header: Asset | null; footer: Asset | null };

export async function loadWorkOrderLetterheadAssets(snapshot: any, letterheadId?: string, companyId?: string): Promise<WorkOrderLetterheadAssets> {
  let selected = snapshot || {};
  if ((!selected.header_storage_bucket || !selected.header_storage_key || !selected.footer_storage_bucket || !selected.footer_storage_key) && letterheadId && companyId) {
    const { data } = await adminClient().from("procurement_company_letterhead_versions")
      .select("id,header_storage_bucket,header_storage_key,footer_storage_bucket,footer_storage_key,letterhead:procurement_company_letterheads!inner(id,company_id,status)")
      .eq("letterhead_id", letterheadId).eq("letterhead.company_id", companyId).eq("letterhead.status", "active")
      .eq("version_status", "ready").not("header_storage_key", "is", null).not("footer_storage_key", "is", null)
      .order("version_number", { ascending: false }).limit(1).maybeSingle();
    if (data) selected = { ...selected, ...data };
  }
  if (!selected.header_storage_bucket || !selected.header_storage_key || !selected.footer_storage_bucket || !selected.footer_storage_key) return { header: null, footer: null };
  const admin = adminClient();
  const [header, footer] = await Promise.all([
    admin.storage.from(selected.header_storage_bucket).download(selected.header_storage_key),
    admin.storage.from(selected.footer_storage_bucket).download(selected.footer_storage_key),
  ]);
  if (header.error || footer.error || !header.data || !footer.data) throw new Error("Selected letterhead assets could not be loaded.");
  const toAsset = async (data: Blob): Promise<Asset> => {
    const bytes = Buffer.from(await data.arrayBuffer());
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const probe = await PDFDocument.create();
    const image = jpeg ? await probe.embedJpg(bytes) : await probe.embedPng(bytes);
    return { data: bytes, width: 595, height: Math.min(112, image.height * 595 / image.width), format: jpeg ? "jpeg" : "png" };
  };
  return { header: await toAsset(header.data), footer: await toAsset(footer.data) };
}

const value = (input: unknown) => String(input ?? "").trim();
const display = (input: unknown) => value(input) || "-";
const money = (input: unknown) => `Rs. ${Number(input || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (input: unknown) => { const parts = value(input).slice(0, 10).split("-"); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : display(input); };
const textWidth = (input: string, size: number) => input.length * size * 0.48;
const wrap = (input: unknown, maxWidth: number, size = BODY_SIZE) => value(input).split(/\r?\n/).flatMap((raw) => {
  const words = raw.split(/\s+/).filter(Boolean).flatMap((word) => {
    if (textWidth(word, size) <= maxWidth) return [word];
    const parts: string[] = [];
    let part = "";
    for (const character of word) {
      const candidate = part + character;
      if (part && textWidth(candidate, size) > maxWidth) { parts.push(part); part = character; } else part = candidate;
    }
    if (part) parts.push(part);
    return parts;
  });
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, size) > maxWidth) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
});

function normalizeKeyTerms(input: any) {
  const rows: Array<{ label: string; value: string }> = [];
  const inclusions = Array.isArray(input?.inclusions) ? input.inclusions : [];
  const exclusions = Array.isArray(input?.exclusions) ? input.exclusions : [];
  if (inclusions.length) rows.push({ label: "Inclusions", value: value(inclusions[0]) });
  if (exclusions.length) rows.push({ label: "Exclusions", value: value(exclusions[0]) });
  for (const entry of inclusions.slice(1)) rows.push({ label: "Inclusions", value: value(entry) });
  for (const entry of exclusions.slice(1)) rows.push({ label: "Exclusions", value: value(entry) });
  for (const entry of Array.isArray(input?.additional) ? input.additional : []) {
    const label = value(entry?.label || entry?.description) || "Additional Term";
    const term = value(entry?.value || entry?.terms);
    if (label || term) rows.push({ label, value: term });
  }
  return rows.length ? rows : [{ label: "Inclusions", value: "" }, { label: "Exclusions", value: "" }];
}

function itemLines(item: any) {
  const lines = [item.item_name_snapshot, item.specification_snapshot, item.additional_description_snapshot].filter((entry) => value(entry));
  return { lines, mode: value(item.make_snapshot) };
}

function drawInline(page: PDFPage, regular: PDFFont, bold: PDFFont, x: number, y: number, maxWidth: number, label: string, text: string) {
  const labelText = `${label} `;
  const labelWidth = bold.widthOfTextAtSize(labelText, BODY_SIZE);
  const valueWidth = regular.widthOfTextAtSize(text, BODY_SIZE);
  if (labelWidth + valueWidth <= maxWidth) {
    page.drawText(labelText, { x, y, size: BODY_SIZE, font: bold, color: rgb(0.05, 0.08, 0.12) });
    page.drawText(text, { x: x + labelWidth, y, size: BODY_SIZE, font: regular, color: rgb(0.05, 0.08, 0.12) });
    return 1;
  }
  const labelLines = wrap(label, maxWidth, BODY_SIZE);
  const valueLines = wrap(text, maxWidth, BODY_SIZE);
  labelLines.forEach((line, index) => page.drawText(line, { x, y: y - index * LEADING, size: BODY_SIZE, font: bold, color: rgb(0.05, 0.08, 0.12) }));
  const valueStart = labelLines.length;
  valueLines.forEach((line, index) => page.drawText(line, { x, y: y - (valueStart + index) * LEADING, size: BODY_SIZE, font: regular, color: rgb(0.05, 0.08, 0.12) }));
  return labelLines.length + valueLines.length;
}

export async function renderWorkOrderPdf(row: any, assets: WorkOrderLetterheadAssets = { header: null, footer: null }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");
  const headerImage = assets.header ? (assets.header.format === "jpeg" ? await pdf.embedJpg(assets.header.data) : await pdf.embedPng(assets.header.data)) : null;
  const footerImage = assets.footer ? (assets.footer.format === "jpeg" ? await pdf.embedJpg(assets.footer.data) : await pdf.embedPng(assets.footer.data)) : null;
  const approvalSignatureAsset = row.approval_signature_asset;
  const approvalSignatureImage = approvalSignatureAsset
    ? approvalSignatureAsset.format === "jpeg"
      ? await pdf.embedJpg(approvalSignatureAsset.data)
      : await pdf.embedPng(approvalSignatureAsset.data)
    : null;
  const pages: PDFPage[] = [];
  let page: PDFPage = null as unknown as PDFPage;
  let y = 0;
  const headerHeight = headerImage ? Math.min(assets.header!.height, 112) : 0;
  const footerHeight = footerImage ? Math.min(assets.footer!.height, 96) : 0;
  const DETAIL_SIZE = 8.5;
  const DETAIL_LEADING = 10;
  const TERMS_SIZE = 8.5;
  const top = () => PAGE_H - Math.max(34, headerHeight + 24);
  const drawPageFrame = () => {
    if (headerImage) page.drawImage(headerImage, { x: 0, y: PAGE_H - headerHeight - 8, width: PAGE_W, height: headerHeight });
    if (footerImage) page.drawImage(footerImage, { x: 0, y: 0, width: PAGE_W, height: footerHeight });
    y = top();
  };
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); pages.push(page); drawPageFrame(); };
  const ensure = (height: number) => { if (y - height < Math.max(BODY_BOTTOM, footerHeight + 22)) newPage(); };
  const draw = (text: string, x: number, yy: number, size = BODY_SIZE, strong = false) => page.drawText(text, { x, y: yy, size, font: strong ? bold : regular, color: rgb(0.05, 0.08, 0.12) });
  const drawRight = (text: string, x: number, yy: number, width: number, size = BODY_SIZE) => draw(text, x + width - 7 - regular.widthOfTextAtSize(text, size), yy, size);
  const rect = (x: number, topY: number, width: number, height: number, fill = false) => page.drawRectangle({ x, y: topY - height, width, height, borderWidth: 0.6, borderColor: BORDER, color: fill ? HEADER_FILL : undefined, opacity: fill ? 1 : 0 });
  const wrapCell = (input: unknown, maxWidth: number, size = BODY_SIZE) => value(input).split(/\r?\n/).flatMap((raw) => {
    const words = raw.split(/\s+/).filter(Boolean).flatMap((word) => {
      if (regular.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const parts: string[] = [];
      let part = "";
      for (const character of word) {
        const candidate = part + character;
        if (part && regular.widthOfTextAtSize(candidate, size) > maxWidth) { parts.push(part); part = character; } else part = candidate;
      }
      if (part) parts.push(part);
      return parts;
    });
    if (!words.length) return [""];
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && regular.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word; } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  });
  const detailLines = (input: unknown, maxWidth: number) => value(input).split(/\r?\n/).flatMap((raw) => {
    const separator = raw.indexOf(":");
    if (separator < 0) return wrapCell(raw, maxWidth, DETAIL_SIZE).map((line) => ({ label: "", value: line }));
    const label = `${raw.slice(0, separator + 1)} `;
    const text = raw.slice(separator + 1).trim();
    const labelWidth = bold.widthOfTextAtSize(label, DETAIL_SIZE);
    const valueLines = wrapCell(text, Math.max(16, maxWidth - labelWidth), DETAIL_SIZE);
    const first = valueLines.shift() || "";
    return [{ label, value: first }, ...valueLines.map((line) => ({ label: "", value: line }))];
  });
  const heading = (text: string, minimumFollowingHeight = 30, size = 10) => {
    const topSpacing = 18;
    const bottomSpacing = 12;
    ensure(topSpacing + 16 + bottomSpacing + minimumFollowingHeight);
    y -= topSpacing;
    draw(text, LEFT, y, size, true);
    y -= 10;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.6, color: BORDER });
    y -= bottomSpacing;
  };
  const block = (headers: [string, string], cells: [string, string]) => {
    const widths = [CONTENT / 2, CONTENT / 2];
    const padding = 6;
    const wrapped = cells.map((cell, i) => detailLines(cell, widths[i] - padding * 2));
    const bodyHeight = Math.max(40, ...wrapped.map((lines) => lines.length * DETAIL_LEADING + padding * 2));
    ensure(24 + bodyHeight + 6);
    rect(LEFT, y, CONTENT, 24, true); draw(headers[0], LEFT + 6, y - 16, BODY_SIZE, true); draw(headers[1], LEFT + widths[0] + 6, y - 16, BODY_SIZE, true); y -= 24;
    rect(LEFT, y, CONTENT, bodyHeight); let x = LEFT;
    cells.forEach((cell, i) => {
      page.pushOperators(pushGraphicsState(), rectangle(x + 1, y - bodyHeight + 1, widths[i] - 2, bodyHeight - 2), clip(), endPath());
      detailLines(cell, widths[i] - padding * 2).forEach((line, n) => {
        const lineY = y - 14 - n * DETAIL_LEADING;
        const labelWidth = line.label ? bold.widthOfTextAtSize(line.label, DETAIL_SIZE) : 0;
        if (line.label) draw(line.label, x + padding, lineY, DETAIL_SIZE, true);
        if (line.value) draw(line.value, x + padding + labelWidth, lineY, DETAIL_SIZE);
      });
      page.pushOperators(popGraphicsState());
      x += widths[i];
    });
    page.drawLine({ start: { x: LEFT + widths[0], y }, end: { x: LEFT + widths[0], y: y - bodyHeight }, thickness: 0.6, color: BORDER }); y -= bodyHeight + 8;
  };
  const table = (headers: string[], rows: any[][], widths: number[], richDescription = false, footerRows: Array<[string, string]> = [], fontSize = BODY_SIZE) => {
    const tableWidth = widths.reduce((sum, width) => sum + width, 0);
    const drawRow = (cells: any[], isHeader = false) => {
      const rowParts = cells.map((cell, i) => {
        if (richDescription && i === 1 && !isHeader) {
          const item = itemLines(cell);
          return { normal: item.lines.flatMap((line) => wrap(line, widths[i] - 10, fontSize)), mode: item.mode };
        }
        return { normal: wrap(cell, widths[i] - 10, fontSize) };
      });
      const heights = rowParts.map((part) => part.normal.length + (part.mode ? 1 : 0));
      const height = Math.max(24, Math.max(...heights) * LEADING + 12);
      const pageCountBeforeEnsure = pages.length;
      ensure(height);
      if (!isHeader && pages.length > pageCountBeforeEnsure) drawRow(headers, true);
      rect(LEFT, y, tableWidth, height, isHeader);
      let x = LEFT;
      rowParts.forEach((part, index) => {
        const lines = part.normal;
        lines.forEach((line, lineIndex) => draw(line, x + 7, y - 9 - lineIndex * LEADING, fontSize, isHeader));
        if (part.mode) drawInline(page, regular, bold, x + 7, y - 9 - lines.length * LEADING, widths[index] - 14, "Mode of Measurement:", part.mode);
        x += widths[index];
      });
      x = LEFT;
      widths.forEach((width) => { page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.6, color: BORDER }); x += width; });
      page.drawLine({ start: { x: LEFT + tableWidth, y }, end: { x: LEFT + tableWidth, y: y - height }, thickness: 0.6, color: BORDER });
      y -= height;
    };
    const drawFooter = (footer: [string, string], isLast = false) => {
      const labelColumnWidth = widths.slice(widths.length - 3, widths.length - 1).reduce((sum, width) => sum + width, 0);
      const amountColumnWidth = widths[widths.length - 1];
      const labelLines = wrapCell(footer[0], labelColumnWidth - 14);
      const height = Math.max(22, labelLines.length * 9 + 8);
      const labelColumnStart = LEFT + tableWidth - amountColumnWidth - labelColumnWidth;
      const amountColumnStart = LEFT + tableWidth - amountColumnWidth;
      const pageCountBeforeEnsure = pages.length;
      ensure(height);
      if (pages.length > pageCountBeforeEnsure) drawRow(headers, true);
      page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT + tableWidth, y }, thickness: 0.6, color: BORDER });
      page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT, y: y - height }, thickness: 0.6, color: BORDER });
      page.drawLine({ start: { x: labelColumnStart, y }, end: { x: labelColumnStart, y: y - height }, thickness: 0.6, color: BORDER });
      page.drawLine({ start: { x: amountColumnStart, y }, end: { x: amountColumnStart, y: y - height }, thickness: 0.6, color: BORDER });
      page.drawLine({ start: { x: LEFT + tableWidth, y }, end: { x: LEFT + tableWidth, y: y - height }, thickness: 0.6, color: BORDER });
      labelLines.forEach((line, index) => draw(line, labelColumnStart + 7, y - 8 - index * 9, BODY_SIZE, true));
      drawRight(footer[1], amountColumnStart, y - (height + LEADING) / 2 + 3, amountColumnWidth);
      if (isLast) page.drawLine({ start: { x: LEFT, y: y - height }, end: { x: LEFT + tableWidth, y: y - height }, thickness: 0.6, color: BORDER });
      y -= height;
    };
    drawRow(headers, true);
    rows.forEach((row) => drawRow(row));
    footerRows.forEach((footer, index) => drawFooter(footer, index === footerRows.length - 1));
    y -= 8;
  };

  newPage();
  const company = display(row.company?.company_name || row.company_name);
  draw("Work Order", LEFT + (CONTENT - textWidth("Work Order", 18)) / 2, y, 18, true); y -= 28;
  block(["Vendor Details", "Work Order Details"], [
    `Vendor Name: ${display(row.vendor_snapshot?.vendor_name || row.vendor_name_snapshot)}\nAddress: ${display(row.vendor_snapshot?.address)}\nContact Person: ${display(row.vendor_snapshot?.contact_person || row.vendor_snapshot?.contact_name)}\nMobile: ${display(row.vendor_snapshot?.phone || row.vendor_snapshot?.mobile)}\nEmail: ${display(row.vendor_snapshot?.email)}\nGSTIN: ${display(row.vendor_snapshot?.gstin)}`,
    `Work Order No: ${display(row.po_number || row.wo_number)}\nDate: ${date(row.po_date || row.wo_date)}\nCompany: ${company}\nSite: ${display(row.site?.site_name || row.site_name)}`,
  ]);
  const delivery = row.delivery_snapshot || {};
  const billing = delivery.gst_billing || row.billing_snapshot || {};
  const shipping = delivery.delivery_location || row.delivery_snapshot || {};
  block(["Billing Address", "Shipping / Delivery Address"], [
    `Company: ${company}\nGSTIN: ${display(billing.gstin || row.gst_snapshot?.gstin)}\nAddress: ${display([billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", ") || billing.address)}\nContact Person: ${display((delivery.billing_contact || row.billing_contact_snapshot)?.contact_name)}\nMobile: ${display((delivery.billing_contact || row.billing_contact_snapshot)?.mobile)}\nEmail: ${display((delivery.billing_contact || row.billing_contact_snapshot)?.email)}`,
    `Company: ${display(shipping.company_name || shipping.location_name)}\nGSTIN: ${display(shipping.gstin || billing.gstin)}\nSite / Location: ${display(shipping.location_name || row.site_name)}\nAddress: ${display(shipping.address || [shipping.address_line1, shipping.address_line2, shipping.city, shipping.state, shipping.pincode].filter(Boolean).join(", "))}\nContact Person: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.contact_name)}\nMobile: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.mobile)}\nEmail: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.email)}`,
  ]);
  heading("ITEMS", 58);
  const itemRows = (row.items || []).map((item: any, index: number) => ({
    ...item,
    item_name_snapshot: item.item_name_snapshot || item.item_header_snapshot,
    specification_snapshot: item.specification_snapshot || item.description_snapshot,
    make_snapshot: item.make_snapshot || item.mode_of_measurement_snapshot,
    serial_no: index + 1,
  }));
  const itemWidths = [32, 168, 30, 45, 55, 65, 50, 66];
  table(["S.No.", "Work Description", "Qty", "Unit", "Unit Rate", "Basic Amount", "GST", "Amount"], itemRows.map((item: any) => {
    const basicAmount = Number(item.quantity || 0) * Number(item.unit_rate || 0);
    const gstAmount = basicAmount * Number(item.gst_rate ?? item.gst_percent ?? 0) / 100;
    return [String(item.serial_no), item, display(item.quantity), display(item.uom_snapshot || item.unit_snapshot), money(item.unit_rate), money(basicAmount), display(item.gst_rate ?? item.gst_percent) + "%\n" + money(gstAmount), money(item.total_amount ?? item.line_total)];
  }), itemWidths, true, [
    ["Total Basic Amount", money(row.total_basic_amount)],
    ["GST", money(row.total_gst_amount)],
    ["Total Amount", money(row.total_amount)],
  ]);
  heading("KEY TERMS", 58, 11);
  table(["S.No.", "Key Term", "Terms"], normalizeKeyTerms(row.work_order_key_terms).map((term, index) => [String(index + 1), term.label, term.value]), [32, 120, CONTENT - 152], false, [], 8.5);
  heading("TERMS & CONDITIONS", 70);
  const termsLines = value(row.standard_terms_snapshot || "-").split(/\r?\n/).filter((line) => line.trim());
  const termsLeading = 9;
  const clauseBlocks: Array<{ heading: string; body: string[] }> = [];
  let currentClause: { heading: string; body: string[] } | null = null;
  termsLines.forEach((line) => {
    if (/^\s*\d+\.\s+\S/.test(line)) {
      currentClause = { heading: line, body: [] };
      clauseBlocks.push(currentClause);
    } else if (currentClause) {
      currentClause.body.push(line);
    } else {
      clauseBlocks.push({ heading: "", body: [line] });
    }
  });
  clauseBlocks.forEach((clause) => {
    const headingLines = clause.heading ? wrap(clause.heading, CONTENT, TERMS_SIZE) : [];
    const bodyLines = clause.body.flatMap((line) => wrap(line, CONTENT, TERMS_SIZE));
    const totalLines = headingLines.length + bodyLines.length;
    const availableLines = Math.max(1, Math.floor((y - Math.max(BODY_BOTTOM, footerHeight + 22)) / termsLeading));
    if (headingLines.length && totalLines <= availableLines) ensure(totalLines * termsLeading);
    else if (headingLines.length) ensure((headingLines.length + Math.min(1, bodyLines.length)) * termsLeading);
    headingLines.forEach((line) => { draw(line, LEFT, y - 4, TERMS_SIZE, true); y -= termsLeading; });
    bodyLines.forEach((line) => { ensure(termsLeading); draw(line, LEFT, y - 4, TERMS_SIZE, false); y -= termsLeading; });
  });

  const approved = ["approved", "issued"].includes(String(row.approval_status || row.status || "").toLowerCase());
  const signaturePadding = 12;
  const dividerX = LEFT + CONTENT / 2;
  const leftX = LEFT + signaturePadding;
  const rightX = dividerX + signaturePadding;
  const cellWidth = CONTENT / 2 - signaturePadding * 2;
  const signatureText = (input: unknown) => value(input) || "—";
  const creatorName = signatureText(row.created_by_name || row.created_by_email);
  const creatorEmail = signatureText(row.created_by_email);
  const creatorAt = row.created_at ? new Date(row.created_at).toLocaleString("en-IN") : signatureText(row.created_at_display);
  const approverName = signatureText(row.approved_by_name || row.approved_by_email || row.approval_signature_block?.employeeName);
  const approverEmail = signatureText(row.approved_by_email);
  const approverAt = row.approved_at ? new Date(row.approved_at).toLocaleString("en-IN") : "—";
  const vendorLines = [
    ["Vendor Acceptance", true, 9],
    ["I hereby accept the terms and conditions of this Work Order and confirm acceptance on behalf of the Vendor.", false, 8],
    [`For: ${signatureText(row.vendor_snapshot?.vendor_name || row.vendor_name_snapshot)}`, false, 8],
    ["", false, 8],
    ["Name: ____________________", false, 8],
    ["", false, 8],
    ["Designation: ____________________", false, 8],
    ["", false, 8],
    ["Signature: ____________________", false, 8],
  ] as Array<[string, boolean, number]>;
  const internalLines = (approved ? [
    ["Approved By", true, 9],
    [`Name: ${approverName}`, false, 8],
    [`Email: ${approverEmail}`, false, 8],
    [`Approved At: ${approverAt}`, false, 8],
  ] : [
    ["Created By", true, 9],
    [`Name: ${creatorName}`, false, 8],
    [`Email: ${creatorEmail}`, false, 8],
    [`Created At: ${creatorAt}`, false, 8],
  ]) as Array<[string, boolean, number]>;
  const wrapSignature = (input: string, maxWidth: number, size: number) => wrapCell(input, maxWidth, size);
  const prepareSignatureLines = (lines: Array<[string, boolean, number]>) => lines.flatMap(([text, strong, size]) => wrapSignature(text, cellWidth, size).map((line) => [line, strong, size] as [string, boolean, number]));
  const leftSignatureLines = prepareSignatureLines(vendorLines);
  const rightSignatureLines = prepareSignatureLines(internalLines);
  const signatureImageScale = approvalSignatureImage ? Math.min(150 / Math.max(1, approvalSignatureImage.width), 45 / Math.max(1, approvalSignatureImage.height), 1) : 0;
  const signatureImageWidth = approvalSignatureImage ? approvalSignatureImage.width * signatureImageScale : 0;
  const signatureImageHeight = approvalSignatureImage ? approvalSignatureImage.height * signatureImageScale : 0;
  const signatureLineHeight = 11;
  const signatureTableHeight = signaturePadding * 2 + Math.max(leftSignatureLines.length, rightSignatureLines.length) * signatureLineHeight + (signatureImageHeight ? signatureImageHeight + 6 : 0);
  if (!page) newPage();
  ensure(signatureTableHeight + 20);
  y -= 20;
  const signatureTop = y;
  const signatureBottom = signatureTop - signatureTableHeight;
  page.drawLine({ start: { x: LEFT, y: signatureTop }, end: { x: RIGHT, y: signatureTop }, thickness: 0.6, color: BORDER });
  page.drawLine({ start: { x: LEFT, y: signatureBottom }, end: { x: RIGHT, y: signatureBottom }, thickness: 0.6, color: BORDER });
  page.drawLine({ start: { x: LEFT, y: signatureBottom }, end: { x: LEFT, y: signatureTop }, thickness: 0.6, color: BORDER });
  page.drawLine({ start: { x: RIGHT, y: signatureBottom }, end: { x: RIGHT, y: signatureTop }, thickness: 0.6, color: BORDER });
  page.drawLine({ start: { x: dividerX, y: signatureBottom }, end: { x: dividerX, y: signatureTop }, thickness: 0.6, color: BORDER });
  const drawSignatureLines = (lines: Array<[string, boolean, number]>, x: number) => lines.forEach(([text, strong, size], index) => { if (text) draw(text, x, signatureTop - signaturePadding - 8 - index * signatureLineHeight, size, strong); });
  drawSignatureLines(leftSignatureLines, leftX);
  drawSignatureLines(rightSignatureLines, rightX);
  if (approvalSignatureImage) page.drawImage(approvalSignatureImage, { x: rightX, y: signatureBottom + signaturePadding + 8, width: signatureImageWidth, height: signatureImageHeight });
  return Buffer.from(await pdf.save());
}
