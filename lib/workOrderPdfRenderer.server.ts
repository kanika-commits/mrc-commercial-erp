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
const BLACK = rgb(0.05, 0.05, 0.05);
const RED = rgb(0.78, 0.05, 0.05);

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
export type WorkOrderRedline = { kind: "unchanged" | "changed" | "added" | "deleted"; value: unknown; previous?: unknown; runs?: Array<{ text: string; color: "black" | "red"; strike?: boolean }> };

export function structuredTermsFromSnapshot(input: unknown): any[] | null {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const record = input as { clauses?: unknown; sections?: unknown; standard_terms_clauses?: unknown; terms?: unknown; standard_terms?: unknown };
    if (Array.isArray(record.clauses)) return record.clauses;
    if (Array.isArray(record.sections)) return record.sections;
    if (Array.isArray(record.standard_terms_clauses)) return record.standard_terms_clauses;
    if (Array.isArray(record.terms)) return record.terms;
    if (Array.isArray(record.standard_terms)) return record.standard_terms;
    return null;
  }
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    return structuredTermsFromSnapshot(JSON.parse(input));
  } catch {
    return null;
  }
}
function normalizeStructuredTerms(input: unknown): Array<{ heading: string; clause_body: string; sort_order: number; identity: string }> | null {
  const clauses = structuredTermsFromSnapshot(input);
  if (!clauses) return null;
  return clauses
    .filter((clause: any) => clause && (value(clause.heading ?? clause.title ?? clause.name ?? clause.clause_heading ?? clause.section_heading ?? clause.heading_text) || value(clause.clause_body ?? clause.body_text ?? clause.bodyText ?? (typeof clause.body === "string" ? clause.body : clause.body?.text ?? clause.body?.content) ?? clause.text ?? clause.content ?? clause.description ?? clause.terms)))
    .map((clause: any, index: number) => ({
      heading: value(clause.heading ?? clause.title ?? clause.name ?? clause.clause_heading ?? clause.section_heading ?? clause.heading_text),
      clause_body: String(clause.clause_body ?? clause.body_text ?? clause.bodyText ?? (typeof clause.body === "string" ? clause.body : clause.body?.text ?? clause.body?.content) ?? clause.text ?? clause.content ?? clause.description ?? clause.terms ?? ""),
      sort_order: Number.isFinite(Number(clause.sort_order)) ? Number(clause.sort_order) : index,
      identity: String(clause.id || clause.clause_id || clause.standard_term_id || clause.sort_order || clause.heading || index),
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}
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
  if (Array.isArray(input)) return input.map((entry: any) => ({ label: value(entry?.label || entry?.heading || entry?.description || "Additional Term"), value: value(entry?.value || entry?.terms || entry?.body) }));
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

export async function renderWorkOrderPdf(row: any, assets: WorkOrderLetterheadAssets = { header: null, footer: null }, revisionMeta?: { revisionNumber: number; applicableDate: string; notice: string; redlines?: { fields?: Record<string, WorkOrderRedline>; items?: any[]; totals?: Record<string, WorkOrderRedline>; keyTerms?: Array<{ label?: WorkOrderRedline; value?: WorkOrderRedline }>; terms?: any[] } }) {
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
  const drawRevisionText = (diff: WorkOrderRedline | undefined, x: number, maxWidth: number, size: number, strong = false) => {
    if (!diff) return 0;
    const drawValue = (input: unknown, color: any, strike = false) => {
      const lines = wrapCell(display(input), maxWidth, size);
      lines.forEach((line) => {
        ensure(10);
        page.drawText(line, { x, y: y - 4, size, font: strong ? bold : regular, color });
        if (strike) page.drawLine({ start: { x, y: y - 1 }, end: { x: x + (strong ? bold : regular).widthOfTextAtSize(line, size), y: y - 1 }, thickness: 0.8, color: BLACK });
        y -= 9;
      });
      return lines.length;
    };
    if (diff.kind === "changed") return drawValue(diff.previous, BLACK, true) + drawValue(diff.value, RED);
    return drawValue(diff.value, diff.kind === "deleted" ? BLACK : RED, diff.kind === "deleted");
  };
  const revisionLineCount = (diff: WorkOrderRedline | undefined, maxWidth: number, size = BODY_SIZE) => {
    if (!diff || diff.kind === "unchanged") return wrapCell(display(diff?.value), maxWidth, size).length;
    const oldLines = diff.kind === "changed" || diff.kind === "deleted" ? wrapCell(display(diff.previous ?? diff.value), maxWidth, size).length : 0;
    const newLines = diff.kind === "changed" || diff.kind === "added" ? wrapCell(display(diff.value), maxWidth, size).length : 0;
    return Math.max(1, oldLines + newLines);
  };
  const drawRevisionLines = (diff: WorkOrderRedline | undefined, x: number, topY: number, maxWidth: number, size = BODY_SIZE, strong = false, allowStrike = true) => {
    if (!diff || diff.kind === "unchanged") {
      const lines = wrapCell(display(diff?.value), maxWidth, size);
      lines.forEach((line, index) => draw(line, x, topY - index * LEADING, size, strong));
      return lines.length;
    }
    let offset = 0;
    const font = strong ? bold : regular;
    if (diff.runs?.length) {
      let lineRuns: Array<{ text: string; color: "black" | "red"; strike?: boolean }> = [];
      const flush = () => {
        if (!lineRuns.length) return;
        const mergedRuns: typeof lineRuns = lineRuns;
        let currentX = x;
        for (const run of mergedRuns) {
          const runWidth = font.widthOfTextAtSize(run.text, size);
          page.drawText(run.text, { x: currentX, y: topY - offset * LEADING, size, font, color: run.color === "red" ? RED : BLACK });
          if (allowStrike && run.strike) page.drawLine({ start: { x: currentX, y: topY - offset * LEADING + size / 3 }, end: { x: currentX + runWidth, y: topY - offset * LEADING + size / 3 }, thickness: 0.8, color: BLACK });
          currentX += runWidth;
        }
        offset += 1;
        lineRuns = [];
      };
      for (const run of diff.runs) {
        for (const word of run.text.split(/(\s+)/).filter(Boolean).map((part) => /\s/.test(part) ? " " : part)) {
          const candidate = lineRuns.map((entry) => entry.text).join("") + word;
          if (lineRuns.length && font.widthOfTextAtSize(candidate, size) > maxWidth) flush();
          lineRuns.push({ ...run, text: word });
        }
      }
      flush();
      return Math.max(1, offset);
    }
    const paint = (input: unknown, color: any, strike: boolean) => {
      for (const line of wrapCell(display(input), maxWidth, size)) {
        page.drawText(line, { x, y: topY - offset * LEADING, size, font, color });
        if (allowStrike && strike) page.drawLine({ start: { x, y: topY - offset * LEADING + size / 3 }, end: { x: x + font.widthOfTextAtSize(line, size), y: topY - offset * LEADING + size / 3 }, thickness: 0.8, color: BLACK });
        offset += 1;
      }
    };
    if (diff.kind === "changed" || diff.kind === "deleted") paint(diff.previous ?? diff.value, BLACK, true);
    if (diff.kind === "changed" || diff.kind === "added") paint(diff.value, RED, false);
    return Math.max(1, offset);
  };
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
  const block = (headers: [string, string], cells: [string, string], redlineKeys: [Record<string, string>, Record<string, string>] = [{}, {}]) => {
    const widths = [CONTENT / 2, CONTENT / 2];
    const padding = 6;
    const wrapped = cells.map((cell, i) => detailLines(cell, widths[i] - padding * 2));
    const redlines = revisionMeta?.redlines?.fields || {};
    const bodyHeight = Math.max(40, ...wrapped.map((lines, i) => lines.reduce((sum, line) => sum + (line.label && redlineKeys[i][line.label.replace(/:\s*$/, "")] ? revisionLineCount((revisionMeta?.redlines?.fields || {})[redlineKeys[i][line.label.replace(/:\s*$/, "")]], widths[i] - padding * 2, DETAIL_SIZE) : 1), 0) * DETAIL_LEADING + padding * 2));
    ensure(24 + bodyHeight + 6);
    rect(LEFT, y, CONTENT, 24, true); draw(headers[0], LEFT + 6, y - 16, BODY_SIZE, true); draw(headers[1], LEFT + widths[0] + 6, y - 16, BODY_SIZE, true); y -= 24;
    rect(LEFT, y, CONTENT, bodyHeight); let x = LEFT;
    cells.forEach((cell, i) => {
      page.pushOperators(pushGraphicsState(), rectangle(x + 1, y - bodyHeight + 1, widths[i] - 2, bodyHeight - 2), clip(), endPath());
      detailLines(cell, widths[i] - padding * 2).forEach((line, n) => {
        const lineY = y - 14 - n * DETAIL_LEADING;
        const labelWidth = line.label ? bold.widthOfTextAtSize(line.label, DETAIL_SIZE) : 0;
        if (line.label) draw(line.label, x + padding, lineY, DETAIL_SIZE, true);
        const key = line.label ? redlineKeys[i][line.label.replace(/:\s*$/, "")] : undefined;
        const diff = key ? redlines[key] : undefined;
        if (line.value && diff && diff.kind !== "unchanged") {
          const renderedDiff = key === "wo_date" ? { ...diff, value: date(diff.value), previous: diff.previous == null ? undefined : date(diff.previous) } : diff;
          drawRevisionLines(renderedDiff, x + padding + labelWidth, lineY, widths[i] - padding * 2 - labelWidth, DETAIL_SIZE);
        }
        else if (line.value) draw(line.value, x + padding + labelWidth, lineY, DETAIL_SIZE);
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
        const cellValue = cell && typeof cell === "object" && "text" in cell ? (cell as any).text : cell;
        const cellDiff = cell && typeof cell === "object" && "diff" in cell ? (cell as any).diff : undefined;
        if (richDescription && i === 1 && !isHeader) {
          const item = itemLines(cellValue);
          const itemFields = cell && typeof cell === "object" && "itemFields" in cell ? (cell as any).itemFields : undefined;
          const keys = ["item_header_snapshot", "description_snapshot", "additional_description_snapshot"];
          const styled = item.lines.flatMap((line, lineIndex) => wrap(line, widths[i] - 10, fontSize).map((wrappedLine) => ({ text: wrappedLine, diff: itemFields?.[keys[lineIndex]] })));
          return { normal: styled.map((line) => line.text), styled, mode: item.mode, diff: cellDiff, source: cell };
        }
        return { normal: wrap(cellValue, widths[i] - 10, fontSize), diff: cellDiff, source: cell };
      });
      const heights = rowParts.map((part) => part.styled ? part.styled.reduce((sum, line) => sum + revisionLineCount(line.diff, widths[rowParts.indexOf(part)] - 14, fontSize), 0) + (part.mode ? 1 : 0) : part.diff && part.diff.kind !== "unchanged" ? revisionLineCount(part.diff, widths[rowParts.indexOf(part)] - 14, fontSize) : part.normal.length + (part.mode ? 1 : 0));
      const height = Math.max(24, Math.max(...heights) * LEADING + 12);
      const pageCountBeforeEnsure = pages.length;
      ensure(height);
      if (!isHeader && pages.length > pageCountBeforeEnsure) drawRow(headers, true);
      rect(LEFT, y, tableWidth, height, isHeader);
      let x = LEFT;
      rowParts.forEach((part, index) => {
        const lines = part.normal;
        if (part.styled) {
          let styledY = y - 9;
          for (const line of part.styled) { const count = drawRevisionLines(line.diff, x + 7, styledY, widths[index] - 14, fontSize, isHeader); styledY -= count * LEADING; }
          if (part.mode) {
            const modeDiff = part.source && typeof part.source === "object" && "itemFields" in part.source ? (part.source as any).itemFields?.make_snapshot : undefined;
            if (modeDiff && modeDiff.kind !== "unchanged") {
              const label = "Mode of Measurement: ";
              page.drawText(label, { x: x + 7, y: styledY, size: fontSize, font: bold, color: modeDiff.kind === "added" ? RED : BLACK });
              drawRevisionLines(modeDiff, x + 7 + bold.widthOfTextAtSize(label, fontSize), styledY, widths[index] - 14 - bold.widthOfTextAtSize(label, fontSize), fontSize, false);
            } else drawInline(page, regular, bold, x + 7, styledY, widths[index] - 14, "Mode of Measurement:", part.mode);
          }
        } else if (part.diff && part.diff.kind !== "unchanged") drawRevisionLines(part.diff, x + 7, y - 9, widths[index] - 14, fontSize, isHeader);
        else lines.forEach((line, lineIndex) => draw(line, x + 7, y - 9 - lineIndex * LEADING, fontSize, isHeader));
        x += widths[index];
      });
      x = LEFT;
      widths.forEach((width) => { page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.6, color: BORDER }); x += width; });
      page.drawLine({ start: { x: LEFT + tableWidth, y }, end: { x: LEFT + tableWidth, y: y - height }, thickness: 0.6, color: BORDER });
      y -= height;
    };
    const drawFooter = (footer: [string, string], isLast = false, diff?: WorkOrderRedline) => {
      const labelColumnWidth = widths.slice(widths.length - 3, widths.length - 1).reduce((sum, width) => sum + width, 0);
      const amountColumnWidth = widths[widths.length - 1];
      const labelLines = wrapCell(footer[0], labelColumnWidth - 14);
      const height = Math.max(22, labelLines.length * 9 + 8, diff && diff.kind !== "unchanged" ? revisionLineCount(diff, amountColumnWidth - 14, BODY_SIZE) * LEADING + 8 : 22);
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
      if (diff && diff.kind !== "unchanged") {
        const previous = diff.previous == null ? undefined : (footer[1].startsWith("Rs. ") ? money(diff.previous) : String(diff.previous));
        drawRevisionLines({ ...diff, value: footer[1], previous }, amountColumnStart, y - 8, amountColumnWidth, BODY_SIZE, false);
      }
      else drawRight(footer[1], amountColumnStart, y - (height + LEADING) / 2 + 3, amountColumnWidth);
      if (isLast) page.drawLine({ start: { x: LEFT, y: y - height }, end: { x: LEFT + tableWidth, y: y - height }, thickness: 0.6, color: BORDER });
      y -= height;
    };
    drawRow(headers, true);
    rows.forEach((row) => drawRow(row));
    footerRows.forEach((footer, index) => {
      const totalKey = ["total_basic_amount", "total_gst_amount", "total_amount"][index];
      drawFooter(footer, index === footerRows.length - 1, revisionMeta?.redlines?.totals?.[totalKey]);
    });
    y -= 8;
  };

  newPage();
  const company = display(row.company?.company_name || row.company_name);
  draw(revisionMeta ? `Revised Work Order R${revisionMeta.revisionNumber}` : "Work Order", LEFT + (CONTENT - textWidth(revisionMeta ? `Revised Work Order R${revisionMeta.revisionNumber}` : "Work Order", 18)) / 2, y, 18, true); y -= 28;
  if (revisionMeta) { const noticeLines = wrap(revisionMeta.notice, CONTENT, BODY_SIZE); ensure(noticeLines.length * LEADING + 8); noticeLines.forEach((line) => { draw(line, LEFT, y, BODY_SIZE, true); y -= LEADING; }); y -= 8; }
  block(["Vendor Details", "Work Order Details"], [
    `Vendor Name: ${display(row.vendor_snapshot?.vendor_name || row.vendor_name_snapshot)}\nAddress: ${display(row.vendor_snapshot?.address)}\nContact Person: ${display(row.vendor_snapshot?.contact_person || row.vendor_snapshot?.contact_name)}\nMobile: ${display(row.vendor_snapshot?.phone || row.vendor_snapshot?.mobile)}\nEmail: ${display(row.vendor_snapshot?.email)}\nGSTIN: ${display(row.vendor_snapshot?.gstin)}`,
    revisionMeta
      ? `Work Order No: ${display(row.po_number || row.wo_number)}\nOriginal Work Order Date: ${date(row.original_wo_date)}\nWO Revision Applicable Date: ${date(row.wo_date)}\nCompany: ${company}\nSite: ${display(row.site?.site_name || row.site_name)}`
      : `Work Order No: ${display(row.po_number || row.wo_number)}\nDate: ${date(row.po_date || row.wo_date)}\nCompany: ${company}\nSite: ${display(row.site?.site_name || row.site_name)}`,
  ], [{}, { "Work Order No": "wo_number", Date: "wo_date", "WO Revision Applicable Date": "wo_date", Company: "company_id", Site: "site_id" }]);
  const delivery = row.delivery_snapshot || {};
  const billing = { ...(row.billing_snapshot || {}), ...(delivery.gst_billing || {}), ...(delivery.billing_address || {}) };
  const shipping = delivery.delivery_location || row.delivery_snapshot || {};
  block(["Billing Address", "Shipping / Delivery Address"], [
    `Company: ${company}\nGSTIN: ${display(billing.gstin || row.gst_snapshot?.gstin)}\nAddress: ${display([billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", ") || billing.address)}\nContact Person: ${display((delivery.billing_contact || row.billing_contact_snapshot || row.billing_contact)?.contact_name || (delivery.billing_contact || row.billing_contact_snapshot || row.billing_contact)?.name)}\nMobile: ${display((delivery.billing_contact || row.billing_contact_snapshot || row.billing_contact)?.mobile || (delivery.billing_contact || row.billing_contact_snapshot || row.billing_contact)?.phone)}\nEmail: ${display((delivery.billing_contact || row.billing_contact_snapshot || row.billing_contact)?.email)}`,
    `Company: ${display(shipping.company_name || shipping.location_name)}\nGSTIN: ${display(shipping.gstin || billing.gstin)}\nSite / Location: ${display(shipping.location_name || row.site_name)}\nAddress: ${display(shipping.address || [shipping.address_line1, shipping.address_line2, shipping.city, shipping.state, shipping.pincode].filter(Boolean).join(", "))}\nContact Person: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.contact_name)}\nMobile: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.mobile)}\nEmail: ${display((delivery.delivery_contact || row.delivery_contact_snapshot)?.email)}`,
  ]);
  heading("ITEMS", 58);
  const revisionItems = revisionMeta?.redlines?.items || [];
  const itemRows = (row.items || []).map((item: any, index: number) => ({
    ...item,
    __revision: revisionItems[index],
    item_name_snapshot: item.item_name_snapshot || item.item_header_snapshot,
    specification_snapshot: item.specification_snapshot || item.description_snapshot,
    make_snapshot: item.make_snapshot || item.mode_of_measurement_snapshot,
    serial_no: index + 1,
  }));
  const deletedItemRows = revisionItems.slice(itemRows.length).filter((entry: any) => entry.current == null && entry.previous).map((entry: any, index: number) => ({
    ...entry.previous,
    item_name_snapshot: entry.previous.item_name_snapshot || entry.previous.item_header_snapshot,
    specification_snapshot: entry.previous.specification_snapshot || entry.previous.description_snapshot,
    make_snapshot: entry.previous.make_snapshot || entry.previous.mode_of_measurement_snapshot,
    __revision: entry,
    serial_no: itemRows.length + index + 1,
  }));
  const allItemRows = [...itemRows, ...deletedItemRows];
  const itemWidths = [32, 168, 30, 45, 55, 65, 50, 66];
  const renderedItemRows = allItemRows.map((item: any) => {
    const basicAmount = Number(item.quantity || 0) * Number(item.unit_rate || 0);
    const gstAmount = basicAmount * Number(item.gst_rate ?? item.gst_percent ?? 0) / 100;
    return [String(item.serial_no), item, display(item.quantity), display(item.uom_snapshot || item.unit_snapshot), money(item.unit_rate), money(basicAmount), display(item.gst_rate ?? item.gst_percent) + "%\n" + money(gstAmount), money(item.total_amount ?? item.line_total)];
  }).map((item: any[]) => {
    const source = item[1];
    const diff = source.__revision?.fields || {};
    const cell = (text: any, key: string, format: (input: unknown) => string = display) => {
      const currentDiff = diff[key];
      return { text, diff: currentDiff ? { ...currentDiff, value: format(currentDiff.value), previous: currentDiff.previous === undefined ? undefined : format(currentDiff.previous) } : undefined, itemFields: key === "description_snapshot" ? diff : undefined };
    };
    return [item[0], cell(source, "description_snapshot"), cell(item[2], "quantity"), cell(item[3], "unit_snapshot"), cell(item[4], "unit_rate", money), cell(item[5], "basic_amount", money), cell(item[6], "gst_amount"), cell(item[7], "total_amount", money)];
  });
  table(["S.No.", "Work Description", "Qty", "Unit", "Unit Rate", "Basic Amount", "GST", "Amount"], renderedItemRows, itemWidths, true, [
    ["Total Basic Amount", money(row.total_basic_amount)],
    ["GST", money(row.total_gst_amount)],
    ["Total Amount", money(row.total_amount)],
  ]);
  heading("KEY TERMS", 58, 11);
  const keyTermDiffs: Array<{ label?: WorkOrderRedline; value?: WorkOrderRedline }> = revisionMeta?.redlines?.keyTerms || [];
  const currentKeyTermRows = normalizeKeyTerms(row.work_order_key_terms);
  const keyTermDiffFor = (term: { label: string }, index: number) => keyTermDiffs.find((candidate: any) => String(candidate.identity || candidate.label?.value || "").toLowerCase() === term.label.toLowerCase()) || keyTermDiffs[index];
  const keyTermRows = currentKeyTermRows.map((term, index) => { const termDiff = keyTermDiffFor(term, index); return [String(index + 1), { text: term.label, diff: termDiff?.label }, { text: term.value, diff: termDiff?.value }]; });
  keyTermDiffs.slice(currentKeyTermRows.length).forEach((term, index) => keyTermRows.push([String(currentKeyTermRows.length + index + 1), { text: String(term.label?.previous ?? term.label?.value ?? ""), diff: term.label }, { text: String(term.value?.previous ?? term.value?.value ?? ""), diff: term.value }]));
  table(["S.No.", "Key Term", "Terms"], keyTermRows, [32, 120, CONTENT - 152], false, [], 8.5);
  heading("TERMS & CONDITIONS", 70);
  const structuredTerms = normalizeStructuredTerms(Array.isArray(row.standard_terms_clauses) ? row.standard_terms_clauses : row.standard_terms_snapshot);
  const termsLines = value(row.standard_terms_snapshot || "-").split(/\r?\n/).filter((line) => line.trim());
  const termsLeading = 9;
  const clauseBlocks: Array<{ heading: string; body: string[] }> = [];
  let currentClause: { heading: string; body: string[] } | null = null;
  if (structuredTerms) structuredTerms.forEach((clause) => clauseBlocks.push({ heading: clause.heading, body: [clause.clause_body], identity: clause.identity } as any));
  else termsLines.forEach((line) => {
    if (/^\s*\d+\.\s+\S/.test(line)) {
      currentClause = { heading: line, body: [] };
      clauseBlocks.push(currentClause);
    } else if (currentClause) {
      currentClause.body.push(line);
    } else {
      clauseBlocks.push({ heading: "", body: [line] });
    }
  });
  clauseBlocks.forEach((clause, clauseIndex) => {
    const headingLines = clause.heading ? wrap(clause.heading, CONTENT - 22, TERMS_SIZE) : [];
    const bodyLines = clause.body.flatMap((line) => wrap(line, CONTENT - 22, TERMS_SIZE));
    const totalLines = headingLines.length + bodyLines.length;
    const clauseGap = 5;
    if (headingLines.length) ensure(Math.min(Math.max(1, totalLines), 8) * termsLeading + clauseGap);
    const serial = `${clauseIndex + 1}.`;
    draw(serial, LEFT, y - 4, TERMS_SIZE, true);
    let lineOffset = 0;
    const termDiff = revisionMeta?.redlines?.terms?.find((candidate: any) => candidate.identity === (clause as any).identity);
    const drawDeletedClauseText = (text: unknown, strong: boolean) => {
      const font = strong ? bold : regular;
      const lines = wrapCell(text, CONTENT - 18, TERMS_SIZE);
      for (const line of lines) {
        ensure(termsLeading);
        page.drawText(line, { x: LEFT + 18, y: y - 4, size: TERMS_SIZE, font, color: BLACK });
        y -= termsLeading;
      }
      return lines.length;
    };
    if (termDiff?.current == null && termDiff?.heading?.kind === "deleted") { const count = drawDeletedClauseText(termDiff.heading.value, true); lineOffset += count; }
    else if (termDiff?.heading && termDiff.heading.kind !== "unchanged") { const count = drawRevisionLines(termDiff.heading, LEFT + 18, y - 4, CONTENT - 18, TERMS_SIZE, true, false); y -= count * termsLeading; lineOffset += count; }
    else headingLines.forEach((line) => { ensure(termsLeading); draw(line, LEFT + 18, y - 4, TERMS_SIZE, true); y -= termsLeading; lineOffset += 1; });
    if (termDiff?.current == null && termDiff?.body?.kind === "deleted") { const count = drawDeletedClauseText(termDiff.body.value, false); lineOffset += count; }
    else if (termDiff?.body && termDiff.body.kind !== "unchanged") { const count = drawRevisionLines(termDiff.body, LEFT + 18, y - 4, CONTENT - 18, TERMS_SIZE, false, false); y -= count * termsLeading; lineOffset += count; }
    else bodyLines.forEach((line) => { ensure(termsLeading); draw(line, LEFT + 18, y - 4, TERMS_SIZE, false); y -= termsLeading; lineOffset += 1; });
    y -= clauseGap;
  });
  const extraTermDiffs = revisionMeta?.redlines?.terms?.slice(clauseBlocks.length) || [];
  extraTermDiffs.forEach((term, extraIndex) => {
    const clauseIndex = clauseBlocks.length + extraIndex;
    ensure(termsLeading * 2 + 5);
    draw(`${clauseIndex + 1}.`, LEFT, y - 4, TERMS_SIZE, true);
    drawRevisionText(term.heading, LEFT + 18, CONTENT - 18, TERMS_SIZE, true);
    drawRevisionText(term.body, LEFT + 18, CONTENT - 18, TERMS_SIZE, false);
    y -= termsLeading + 5;
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
